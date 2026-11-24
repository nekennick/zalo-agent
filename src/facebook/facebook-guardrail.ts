import { streamText } from "ai";
import { resolveLanguageModel } from "../agent/llm-provider.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("facebook-guardrail");

export type GuardrailDecision =
  | { action: "PROCEED_TO_AGENT" }
  | { action: "REPLIED"; replyText: string; reason: "GREETING" | "OFF_TOPIC_BANTER" }
  | { action: "MUTED"; reason: "EXCEEDED_OFF_TOPIC_LIMIT" };

export type UserIntent = "IN_SCOPE" | "GREETING" | "OFF_TOPIC";

type OffTopicTracker = {
  count: number;
  lastOffTopicTime: number;
};

// Lưu bộ đếm thẻ vàng theo thread: `${pageId}:${senderPsid}`
const offTopicTrackerMap = new Map<string, OffTopicTracker>();

const MAX_OFF_TOPIC_STRIKES = 3;
const RESET_TIMEOUT_MS = 15 * 60 * 1000; // 15 phút không nhắn ngoài lề thì xóa thẻ phạt

/**
 * Xóa bộ nhớ thẻ phạt (dùng cho unit test hoặc reset thủ công).
 */
export function resetGuardrailTracker(): void {
  offTopicTrackerMap.clear();
}

/**
 * Lấy số thẻ vàng hiện tại của khách.
 */
export function getOffTopicStrikeCount(pageId: string, senderPsid: string): number {
  const key = `${pageId}:${senderPsid}`;
  const info = offTopicTrackerMap.get(key);
  if (!info) return 0;
  if (Date.now() - info.lastOffTopicTime > RESET_TIMEOUT_MS) {
    offTopicTrackerMap.delete(key);
    return 0;
  }
  return info.count;
}

/**
 * Lớp 1: Heuristic siêu nhanh (0 token) để nhận diện chào hỏi cơ bản.
 * Ví dụ: "chào shop", "hi ad", "alo quán ơi", "hé lô bot nhé", "ee shop",...
 */
const GREETING_REGEX =
  /^(chào|chao|hi|hello|hé lô|he lo|alo|ê|ee|ơi|oi|shop|ad|bot)(\s+(bạn|shop|quán|quan|ad|bot|mọi người|em|anh|chị))?(\s+(ơi|oi|nhé|nha|ạ|a))?[!.,?~ ]*$/i;

/**
 * Lớp 1: Heuristic nhận diện nhanh các chủ đề hoàn toàn ngoài lề cửa hàng ẩm thực (0 token).
 * Chặn đứng ngay lập tức các câu troll: giải toán, làm thơ, viết code, hỏi thủ đô, thời sự...
 */
const OFF_TOPIC_KEYWORDS = [
  "giải toán",
  "giai toan",
  "phương trình",
  "phuong trinh",
  "bài toán",
  "bai toan",
  "viết thơ",
  "viet tho",
  "bài thơ",
  "bai tho",
  "thơ tình",
  "tho tinh",
  "làm thơ",
  "lam tho",
  "viết code",
  "viet code",
  "lập trình",
  "lap trinh",
  "python",
  "javascript",
  "thủ đô",
  "thu do",
  "tổng thống",
  "tong thong",
  "chiến tranh",
  "thời tiết hôm nay",
  "1 + 1",
  "2 + 2",
];

/**
 * Lớp 1: Heuristic nhận diện nhanh các câu hỏi rõ ràng về ẩm thực / món ăn (0 token).
 */
const IN_SCOPE_KEYWORDS = [
  "menu",
  "thực đơn",
  "thuc don",
  "món",
  "mon",
  "giá",
  "gia",
  "tiền",
  "tien",
  "bao nhiêu",
  "bao nhieu",
  "bán",
  "ban",
  "mua",
  "đặt",
  "dat",
  "order",
  "ship",
  "giao hàng",
  "giao hang",
  "địa chỉ",
  "dia chi",
  "ở đâu",
  "o dau",
  "giờ mở",
  "gio mo",
  "đóng cửa",
  "dong cua",
  "quán",
  "quan",
  "trà",
  "tra",
  "bánh",
  "banh",
  "nước",
  "nuoc",
  "cơm",
  "com",
  "bún",
  "bun",
  "phở",
  "pho",
  "stk",
  "tài khoản",
  "chuyển khoản",
  "thanh toán",
];

export function fastClassifyIntent(text: string): UserIntent | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "GREETING";

  // 1. Kiểm tra chào hỏi trước
  if (GREETING_REGEX.test(normalized)) {
    return "GREETING";
  }

  // 2. Kiểm tra các câu troll ngoài lề rõ ràng (0 token)
  const isOffTopic = OFF_TOPIC_KEYWORDS.some((kw) => normalized.includes(kw));
  if (isOffTopic) {
    return "OFF_TOPIC";
  }

  // 3. Nếu chứa từ khóa ẩm thực/quán ăn rõ ràng -> IN_SCOPE ngay
  const words = normalized.split(/\s+/);
  const hasInScopeKeyword = IN_SCOPE_KEYWORDS.some((kw) => {
    if (kw.includes(" ")) {
      return normalized.includes(kw);
    }
    return words.includes(kw);
  });

  if (hasInScopeKeyword) {
    return "IN_SCOPE";
  }

  return null; // Cần dùng LLM để phân loại chính xác hơn
}

/**
 * Phân loại ý định qua LLM với prompt tối giản và trần token cực thấp (chỉ ~20-30 input tokens, 1 output token).
 */
export async function classifyIntentWithLlm(text: string): Promise<UserIntent> {
  try {
    const stream = streamText({
      model: resolveLanguageModel(),
      system:
        "Bạn là bộ phân loại ý định tin nhắn gửi tới Fanpage quán ăn/đồ uống Yagami Kitchen.\n" +
        "Phân loại tin nhắn của khách vào đúng 1 trong 3 nhãn:\n" +
        "- IN_SCOPE: Hỏi về thực đơn, món ăn, đồ uống, giá cả, khuyến mãi, vị trí quán, giờ mở cửa, đặt hàng, thanh toán, khiếu nại hoặc dịch vụ của quán.\n" +
        "- GREETING: Lời chào hỏi hoặc mở đầu cuộc trò chuyện thông thường.\n" +
        "- OFF_TOPIC: Bất kỳ câu chuyện nào không liên quan đến ẩm thực/quán ăn (ví dụ: tán gẫu linh tinh, nhờ giải toán, làm thơ, viết code, hỏi thời sự, chính trị, triết lý...).\n\n" +
        "Chỉ trả lời đúng duy nhất 1 từ: IN_SCOPE, GREETING, hoặc OFF_TOPIC.",
      prompt: text,
      maxOutputTokens: 10,
    });

    const result = await stream.text;
    const clean = result.trim().toUpperCase();
    if (clean.includes("IN_SCOPE")) return "IN_SCOPE";
    if (clean.includes("GREETING")) return "GREETING";
    if (clean.includes("OFF_TOPIC")) return "OFF_TOPIC";
  } catch (err) {
    log.warn({ err }, "Lỗi khi gọi model phân loại ý định - mặc định chuyển vào Agent chính");
  }

  return "IN_SCOPE"; // Mặc định an toàn: nếu model lỗi thì không chặn nhầm khách
}

/**
 * Lớp 2: Sinh câu trả lời trêu duyên & bẻ lái về quán ăn (tối đa 80 tokens, không tool, không RAG).
 */
export async function generatePlayfulBanter(userMessage: string): Promise<string> {
  try {
    const stream = streamText({
      model: resolveLanguageModel(),
      system:
        "Bạn là Yumi, nhân viên chăm sóc khách hàng vui tính, lém lỉnh và duyên dáng của quán Yagami Kitchen trên Facebook Messenger.\n" +
        "Khách hàng vừa nhắn một câu ngoài lề không liên quan đến ẩm thực hay quán ăn.\n" +
        "Nhiệm vụ của bạn: Đáp lại 1-2 câu thật ngắn gọn, hài hước, dí dỏm, rồi khéo léo bẻ lái rủ rê khách xem thực đơn hoặc gọi món ăn/nước uống ngon của quán.\n" +
        "Quy tắc tuyệt đối: Không giải toán, không làm thơ dài, không viết code, không bàn chuyện chính trị/thời sự. Tối đa 2 câu.",
      prompt: userMessage,
      maxOutputTokens: 80,
    });

    const text = await stream.text;
    const reply = text.trim();
    if (reply) return reply;
  } catch (err) {
    log.warn({ err }, "Lỗi khi sinh câu trêu duyên dáng - dùng câu mẫu");
  }

  return "Dạ em chỉ là cô phục vụ đam mê ẩm thực của Yagami Kitchen thôi nè 😋 Bác có thèm trà đào hay món gì ngon thì ới em xem thực đơn liền nha!";
}

/**
 * Chốt chặn Guardrail 4 Lớp:
 * - Lớp 1: Phân loại ý định siêu nhanh (0-output / Fast Classify).
 * - Lớp 2: Trêu duyên & bẻ lái (Khóa 80 tokens) khi gặp chuyện ngoài lề lần 1.
 * - Lớp 3: Đếm 3 thẻ vàng (Nhắc nhở và cảnh báo lần 2, lần 3).
 * - Lớp 4: Tự động im lặng (0-token) khi vượt quá 3 lần spam ngoài lề.
 */
export async function applyFacebookGuardrail(params: {
  pageId: string;
  senderPsid: string;
  messageText: string;
}): Promise<GuardrailDecision> {
  const { pageId, senderPsid, messageText } = params;
  const key = `${pageId}:${senderPsid}`;

  // 1. Phân loại ý định (Ưu tiên Heuristic 0-token -> LLM nhẹ)
  const intent = fastClassifyIntent(messageText) ?? (await classifyIntentWithLlm(messageText));
  log.info({ pageId, senderPsid, intent, text: messageText }, "Guardrail phân loại ý định người dùng");

  // 2. Nếu khách hỏi đúng chủ đề cửa hàng -> Reset thẻ phạt & vào Agent chính
  if (intent === "IN_SCOPE") {
    if (offTopicTrackerMap.has(key)) {
      offTopicTrackerMap.delete(key);
      log.info({ key }, "Khách đã quay lại hỏi đúng chủ đề - xóa bộ đếm thẻ phạt");
    }
    return { action: "PROCEED_TO_AGENT" };
  }

  // 3. Nếu là lời chào hỏi cơ bản -> Trả lời câu chào chào mừng mẫu (0 token LLM!)
  if (intent === "GREETING") {
    return {
      action: "REPLIED",
      reason: "GREETING",
      replyText:
        "Dạ Yumi - CSKH Yagami Kitchen chào anh/chị ạ! Quán em hôm nay có nhiều món ngon lắm, anh/chị muốn xem thực đơn hay cần em tư vấn món gì nè 😊",
    };
  }

  // 4. Nếu là OFF_TOPIC: Kiểm tra Lớp 3 & Lớp 4 (Bộ đếm Thẻ Vàng)
  const now = Date.now();
  const currentTracker = offTopicTrackerMap.get(key);
  let strikeCount = 1;

  if (currentTracker && now - currentTracker.lastOffTopicTime <= RESET_TIMEOUT_MS) {
    strikeCount = currentTracker.count + 1;
  }

  offTopicTrackerMap.set(key, { count: strikeCount, lastOffTopicTime: now });
  log.warn({ key, strikeCount }, "Khách hàng dính thẻ phạt nói chuyện ngoài lề");

  // Lớp 4: Vượt quá 3 thẻ vàng -> Tự động im lặng (0 Token, ngắt hoàn toàn)
  if (strikeCount > MAX_OFF_TOPIC_STRIKES) {
    log.warn({ key, strikeCount }, "Khách vượt quá 3 lần cảnh báo - Kích hoạt Lớp 4: Tự động im lặng (0 Token)");
    return { action: "MUTED", reason: "EXCEEDED_OFF_TOPIC_LIMIT" };
  }

  // Lớp 3 - Thẻ vàng thứ 3: Cảnh báo dứt khoát
  if (strikeCount === 3) {
    return {
      action: "REPLIED",
      reason: "OFF_TOPIC_BANTER",
      replyText:
        "Dạ em xin phép chỉ hỗ trợ các câu hỏi liên quan đến món ăn và dịch vụ của Yagami Kitchen thôi ạ. Em xin phép tạm ngưng phản hồi nếu anh/chị tiếp tục trò chuyện ngoài lề nhé ạ!",
    };
  }

  // Lớp 3 - Thẻ vàng thứ 2: Nhắc nhở nhẹ nhàng
  if (strikeCount === 2) {
    return {
      action: "REPLIED",
      reason: "OFF_TOPIC_BANTER",
      replyText:
        "Dạ em chỉ là trợ lý quán ăn thôi nè, giải mấy cái này sếp la em trừ lương chết á 😅 Bác có thèm trà đào, đồ ăn hay thức uống gì thì ới em xem menu phục vụ liền nha!",
    };
  }

  // Lớp 2 - Thẻ vàng thứ 1: Trêu duyên & Bẻ lái (Khóa 80 token)
  const banterReply = await generatePlayfulBanter(messageText);
  return {
    action: "REPLIED",
    reason: "OFF_TOPIC_BANTER",
    replyText: banterReply,
  };
}
