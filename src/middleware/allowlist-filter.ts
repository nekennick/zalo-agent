import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

export type FilterDecision = {
  /** Bot có chạy agent + trả lời không */
  respond: boolean;
  /**
   * Không trả lời nhưng vẫn ghi vào history (passive listening): tin group
   * thiếu @mention, hoặc thread đang tắt bot. Lần tương tác sau agent sẽ
   * thấy được ngữ cảnh xung quanh thay vì chỉ các lần mention rời rạc.
   */
  record: boolean;
  reason: string;
};

const skip = (reason: string): FilterDecision => ({ respond: false, record: false, reason });
const recordOnly = (reason: string): FilterDecision => ({ respond: false, record: true, reason });

export function isWarehouseThread(threadId: string): boolean {
  // Chỉ duy nhất nhóm Báo Nhận Hàng Kho Tổng Cao Lãnh
  return threadId === "515122450907591015";
}

/**
 * Quyết định bot có trả lời tin nhắn này không - chạy TRƯỚC khi gọi LLM
 * để tin bị lọc không tốn token nào.
 *
 * @param botEnabledForThread trạng thái kill switch per thread (bảng threads),
 * caller đọc từ thread-store để module này thuần, test không cần DB.
 */
export function shouldRespond(
  account: AccountConfig,
  msg: ParsedMessage,
  botEnabledForThread = true,
): FilterDecision {
  if (msg.isSelf) {
    return skip("tin của chính bot");
  }

  // Chỉ đọc: ghi MỌI tin (kể cả sticker/thoại, nhóm không @mention, người ngoài
  // allowlist) vì mục đích là log đầy đủ để lọc việc, không phải trả lời
  if (account.readOnly) {
    return recordOnly("chế độ chỉ đọc - chỉ ghi history");
  }

  if (!msg.text.trim() && msg.images.length === 0) {
    return skip("không có nội dung xử lý được (sticker/voice/...)");
  }

  if (msg.isGroup) {
    if (!account.respondToGroups) {
      return skip("account tắt trả lời group");
    }
    // Trong nhóm: bắt buộc phải @mention bot.
    // Ngoại lệ duy nhất: Nhóm Báo Nhận Hàng Kho Tổng Cao Lãnh (isWarehouseThread)
    // để bot âm thầm ghi nhận hàng hóa vào Dashboard mà không cần nhân viên phải @mention bot.
    const isInventoryGroup = isWarehouseThread(msg.threadId);
    if (account.groupRequireMention && !msg.mentionsMe && !isInventoryGroup) {
      return account.groupPassiveListen
        ? recordOnly("group không @mention - chỉ ghi history")
        : skip("group yêu cầu @mention bot");
    }
  }

  // Cho qua nếu sender nằm trong allowlist, HOẶC nếu là tin trong group mà group ID nằm trong allowlist
  if (
    account.allowlist.mode === "list" &&
    !account.allowlist.userIds.includes(msg.senderId) &&
    !(msg.isGroup && account.allowlist.userIds.includes(msg.threadId))
  ) {
    return skip(`sender ${msg.senderId} ngoài allowlist`);
  }

  // Check kill switch SAU allowlist: người ngoài allowlist không được ghi history
  // dù thread tắt bot
  if (!botEnabledForThread) {
    return recordOnly("thread đang tắt bot - chỉ ghi history");
  }

  return { respond: true, record: true, reason: "ok" };
}
