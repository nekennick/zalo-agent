import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let app: any;
let processor: typeof import("./facebook-turn-processor.js");

before(async () => {
  dataDir = setupTestEnv({
    FACEBOOK_VERIFY_TOKEN: "test_fb_token_123",
  });
  const { buildDashboardApp } = await import("../server/dashboard-server.js");
  processor = await import("./facebook-turn-processor.js");
  app = buildDashboardApp();
});

after(async () => {
  await new Promise((r) => setTimeout(r, 600));
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("Facebook Webhook - Xác thực (GET)", () => {
  it("trả về hub.challenge khi token và mode hợp lệ", async () => {
    const res = await app.request(
      "/webhook/facebook?hub.mode=subscribe&hub.verify_token=test_fb_token_123&hub.challenge=CHALLENGE_STRING_123",
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, "CHALLENGE_STRING_123");
  });

  it("trả về 403 khi sai verify_token", async () => {
    const res = await app.request(
      "/webhook/facebook?hub.mode=subscribe&hub.verify_token=SAI_TOKEN&hub.challenge=123",
    );
    assert.equal(res.status, 403);
  });
});

describe("Facebook Webhook - Nhận tin & Human Handoff (POST)", () => {
  it("nhận tin is_echo và đánh dấu nhân viên đang trực page", async () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1789000000,
          messaging: [
            {
              sender: { id: "page_123" },
              recipient: { id: "customer_999" },
              timestamp: 1789000000,
              message: {
                mid: "m_1",
                text: "Dạ em chào anh ạ!",
                is_echo: true,
              },
            },
          ],
        },
      ],
    };

    const res = await app.request("/webhook/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { status: string };
    assert.equal(json.status, "EVENT_RECEIVED");

    // Khách customer_999 phải được đánh dấu là nhân viên đang trực
    assert.equal(processor.isStaffHandling("page_123", "customer_999"), true);
  });

  it("nhận tin nhắn chỉ có ảnh (không text) và chấp nhận xử lý webhook", async () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1789000000,
          messaging: [
            {
              sender: { id: "customer_888" },
              recipient: { id: "page_123" },
              timestamp: 1789000000,
              message: {
                mid: "m_image_1",
                attachments: [
                  {
                    type: "image",
                    payload: {
                      url: "https://example.com/menu.jpg",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await app.request("/webhook/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { status: string };
    assert.equal(json.status, "EVENT_RECEIVED");
  });
});
