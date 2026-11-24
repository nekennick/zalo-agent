import type { AccountConfig } from "../config/account-store.js";
import { createLogger } from "../shared/logger.js";
import type { KenhLuot } from "../zalo/kenh-luot.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import {
  hasInventoryReportPrefix,
  parseItemsFromText,
} from "../agent/tools/record-inventory-import-tool.js";
import { postInventoryDashboard } from "./inventory-dashboard-client.js";
import { isInventoryMessageRecalled, rememberInventoryMessage } from "./inventory-message-store.js";

const log = createLogger("warehouse-safety-net");

/**
 * Lọc các tin nhắn không phải là báo nhận hàng:
 * - Câu giao tiếp, chào hỏi, tag tên người dùng (ví dụ: "@Trần Anh Khoa đây anh ơi", "Dạ anh", "Ok anh")
 * - Câu hoàn toàn không có chữ số (báo nhận hàng bắt buộc phải có số lượng)
 */
export function isLikelyInventoryReportMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!/\d/u.test(trimmed)) return false;
  if (hasInventoryReportPrefix(trimmed)) return true;
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  return /^\d/u.test(firstLine) && parseItemsFromText(firstLine).some((item) => Boolean(item.dvt));
}

/**
 * Hàng rào bảo vệ cho nhóm báo nhận hàng (Safety Net):
 * Đảm bảo các tin nhắn báo nhận hàng trong nhóm kho nếu chưa được AI ghi nhận (do AI lỗi, AI không gọi tool,
 * hoặc tin nhắn khó đoán) thì hệ thống VẪN TỰ ĐỘNG LƯU VÀO DASHBOARD dưới dạng "UNMATCHED / Cần chọn thủ công".
 *
 * Chỉ sau khi Dashboard xác nhận lưu thành công (200 OK) thì bot mới thả tim ❤️ vào tin nhắn Zalo.
 */
export async function runWarehouseSafetyNet(
  config: AccountConfig,
  kenh: KenhLuot,
  messages: ParsedMessage[],
  completeMessageIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const userMessages = messages.filter((m) => !m.isSelf && Boolean(m.text?.trim()) && Boolean(m.msgId));
  if (userMessages.length === 0) return;

  const seen = new Set<string>();
  for (const msg of userMessages) {
    if (seen.has(msg.msgId)) continue;
    seen.add(msg.msgId);
    if (isInventoryMessageRecalled(msg)) continue;
    rememberInventoryMessage(msg);
    // Lọc bỏ ngay các tin nhắn giao tiếp, chào hỏi, tag tên không phải là tin báo nhận hàng
    if (!isLikelyInventoryReportMessage(msg.text)) {
      log.debug(
        { sender: msg.senderName, text: msg.text },
        "Bỏ qua tin nhắn không phải báo nhận hàng (không có số lượng hoặc là câu giao tiếp)",
      );
      continue;
    }

    const items = parseItemsFromText(msg.text);
    if (items.length === 0) {
      log.warn({ msgId: msg.msgId }, "Chưa tách được mặt hàng từ tin báo nhận");
      continue;
    }
    const explicitReport = hasInventoryReportPrefix(msg.text);
    const hasUnreadLine = msg.text.split(/\r?\n/).some((line) => {
      const trimmed = line.trim().replace(/^[-•]\s+/u, "");
      const mayBeItem = explicitReport || /^\d/u.test(trimmed) || hasInventoryReportPrefix(trimmed);
      return mayBeItem && /\d/u.test(trimmed)
        && parseItemsFromText(explicitReport ? `Nhận\n${trimmed}` : trimmed).length === 0;
    });
    if (completeMessageIds.has(msg.msgId)) {
      if (!hasUnreadLine) kenh.tuThaCamXuc?.(config, msg);
      else log.warn({ msgId: msg.msgId }, "Tin báo nhận còn dòng chưa tách được");
      continue;
    }

    const d = new Date(msg.sentAt || Date.now());
    const receivedDate = d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const receivedTime = d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

    const payloadItems = items.map((it) => ({
      sourceAccountId: msg.accountId || config.id,
      sourceMessageId: msg.msgId,
      sourceCliMsgId: msg.cliMsgId,
      threadId: msg.threadId,
      rawItemName: it.tenHang,
      quantity: it.soLuong,
      unit: it.dvt || "chưa rõ",
      status: "UNMATCHED" as const,
      matchedCode: "",
      matchedName: "",
      candidates: [],
      sentAt: msg.sentAt,
      receivedDate,
      receivedTime,
    }));

    try {
      log.info(
        { threadId: msg.threadId, sender: msg.senderName, msg: msg.text },
        "Kích hoạt Safety Net: Đang tự động lưu tin nhắn báo hàng chưa nhận diện vào Dashboard...",
      );

      const receipt = await postInventoryDashboard({
        senderName: msg.senderName || "Nhân viên",
        senderId: msg.senderId,
        threadId: msg.threadId,
        rawMessage: msg.text,
        items: payloadItems,
      });
      if (receipt.success && receipt.count === payloadItems.length && !hasUnreadLine && !isInventoryMessageRecalled(msg)) {
        log.info({ msgId: msg.msgId }, "Safety Net lưu Dashboard thành công -> Thả tim xác nhận lên Zalo");
        // Giao dịch thành công: Chỉ thả tim khi Dashboard đã ghi nhận an toàn!
        kenh.tuThaCamXuc?.(config, msg);
      } else {
        log.warn({ msgId: msg.msgId, expected: payloadItems.length, saved: receipt.count, hasUnreadLine },
          "Tin nhận hàng chưa đủ điều kiện xác nhận");
      }
    } catch (err: unknown) {
      log.error({ err, msgId: msg.msgId }, "Lỗi Safety Net khi kết nối Dashboard - Tuyệt đối không thả tim");
    }
  }
}
