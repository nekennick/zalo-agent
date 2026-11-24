import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let guardrail: typeof import("./facebook-guardrail.js");

before(async () => {
  dataDir = setupTestEnv();
  guardrail = await import("./facebook-guardrail.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("Facebook Guardrail - Heuristic Lớp 1", () => {
  it("nhận diện nhanh các câu chào hỏi (0 token)", () => {
    assert.equal(guardrail.fastClassifyIntent("chào shop"), "GREETING");
    assert.equal(guardrail.fastClassifyIntent("hé lô"), "GREETING");
    assert.equal(guardrail.fastClassifyIntent("hi"), "GREETING");
    assert.equal(guardrail.fastClassifyIntent("alo ad ơi"), "GREETING");
    assert.equal(guardrail.fastClassifyIntent("shop ơi"), "GREETING");
  });

  it("nhận diện nhanh các câu hỏi ẩm thực / món ăn (0 token)", () => {
    assert.equal(guardrail.fastClassifyIntent("quán có menu gì thế"), "IN_SCOPE");
    assert.equal(guardrail.fastClassifyIntent("ly trà đào bao nhiêu tiền"), "IN_SCOPE");
    assert.equal(guardrail.fastClassifyIntent("cho mình đặt 2 phần cơm sườn ship về"), "IN_SCOPE");
    assert.equal(guardrail.fastClassifyIntent("quán ở đâu vậy"), "IN_SCOPE");
  });

  it("nhận diện nhanh các câu hỏi ngoài lề rõ ràng (0 token)", () => {
    assert.equal(guardrail.fastClassifyIntent("giải phương trình bậc 2 giùm"), "OFF_TOPIC");
    assert.equal(guardrail.fastClassifyIntent("viết code python giúp tôi"), "OFF_TOPIC");
    assert.equal(guardrail.fastClassifyIntent("làm thơ tình tặng bạn gái"), "OFF_TOPIC");
  });

  it("trả về null với câu hỏi cần LLM phân loại", () => {
    assert.equal(guardrail.fastClassifyIntent("bạn có người yêu chưa"), null);
    assert.equal(guardrail.fastClassifyIntent("hôm nay là thứ mấy ta"), null);
  });
});

describe("Facebook Guardrail - Chốt Chặn 4 Lớp", () => {
  const pageId = "page_test_123";
  const senderPsid = "user_test_999";

  beforeEach(() => {
    guardrail.resetGuardrailTracker();
  });

  it("Lớp 1: Gặp câu chào hỏi -> trả về ngay câu chào mừng mẫu (0 token LLM chính)", async () => {
    const decision = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Hé lô quán",
    });

    assert.equal(decision.action, "REPLIED");
    if (decision.action === "REPLIED") {
      assert.equal(decision.reason, "GREETING");
      assert.match(decision.replyText, /Yumi - CSKH Yagami Kitchen chào anh\/chị ạ/);
    }
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 0);
  });

  it("Lớp 1: Gặp câu hỏi ẩm thực -> cho phép vào Agent chính", async () => {
    const decision = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Cho mình xem menu và giá các món nước",
    });

    assert.equal(decision.action, "PROCEED_TO_AGENT");
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 0);
  });

  it("Lớp 2, 3, 4: Quản lý Thẻ Vàng khi khách chat ngoài lề và Im lặng khi spam", async () => {
    // Lần 1: Hỏi ngoài lề -> dính 1 thẻ vàng
    const strike1 = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Giải phương trình x^2 + 5x + 6 = 0 giúp tôi",
    });
    assert.equal(strike1.action, "REPLIED");
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 1);

    // Lần 2: Tiếp tục hỏi ngoài lề -> dính 2 thẻ vàng (nhắc nhở)
    const strike2 = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Viết cho tôi một bài thơ tình mùa thu",
    });
    assert.equal(strike2.action, "REPLIED");
    if (strike2.action === "REPLIED") {
      assert.match(strike2.replyText, /sếp la em trừ lương chết á/);
    }
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 2);

    // Lần 3: Tiếp tục hỏi ngoài lề -> dính 3 thẻ vàng (cảnh báo dứt khoát)
    const strike3 = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Thủ đô của nước Pháp là gì vậy bot?",
    });
    assert.equal(strike3.action, "REPLIED");
    if (strike3.action === "REPLIED") {
      assert.match(strike3.replyText, /tạm ngưng phản hồi nếu anh\/chị tiếp tục/);
    }
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 3);

    // Lần 4: Kích hoạt Lớp 4: Tự động im lặng (0 Token, không phản hồi)
    const strike4 = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Vẫn hỏi tiếp: viết code javascript giùm coi",
    });
    assert.equal(strike4.action, "MUTED");
    if (strike4.action === "MUTED") {
      assert.equal(strike4.reason, "EXCEEDED_OFF_TOPIC_LIMIT");
    }

    // Sau khi bị MUTED, nếu khách quay lại hỏi đúng chủ đề -> Reset thẻ phạt và cho vào Agent chính!
    const backInScope = await guardrail.applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText: "Thôi được rồi, quán có món trà dâu không",
    });
    assert.equal(backInScope.action, "PROCEED_TO_AGENT");
    assert.equal(guardrail.getOffTopicStrikeCount(pageId, senderPsid), 0);
  });
});
