import type { AccountConfig } from "../config/account-store.js";
import { botTimeZone, getTuning } from "../config/runtime-tuning-settings.js";
import { todayKey } from "../shared/zone-time.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { refundNotebookLmSlot, tryReserveNotebookLmSlot } from "./notebooklm-store.js";

/**
 * Kiểm tra quyền gọi công cụ `notebooklm` và trần số lượt mỗi ngày theo mục 14.4:
 * - Mặc định (`NOTEBOOKLM_ALLOW_EVERYONE = false`): chỉ chủ bot gọi được.
 *   Chủ bot được nhận diện qua: tin tự gửi (`isSelf`), Zalo ID nhận báo chuyển
 *   người thật (`handoffNotifyUserId`), hoặc các Zalo ID nằm trong `allowlist.userIds`.
 * - Khi bật `NOTEBOOKLM_ALLOW_EVERYONE = true`: mọi người đang chat với bot đều
 *   dùng được, vẫn chịu trần mỗi ngày `NOTEBOOKLM_MAX_PER_DAY`.
 */

const COUNTER_RETENTION_DAYS = 3;

export type NotebookLmGuardCheck = { ok: true; dayKey: string } | { ok: false; reason: string };

export function laChuBot(
  account: Pick<AccountConfig, "allowlist" | "handoffNotifyUserId">,
  message: Pick<ParsedMessage, "senderId" | "isSelf">,
): boolean {
  if (message.isSelf) return true;
  const senderId = message.senderId?.trim();
  if (!senderId) return false;
  if (account.handoffNotifyUserId && account.handoffNotifyUserId.trim() === senderId) {
    return true;
  }
  return account.allowlist.userIds.includes(senderId);
}

export function kiemQuyenVaGiuSuatNotebookLm(
  account: Pick<AccountConfig, "id" | "allowlist" | "handoffNotifyUserId">,
  message: Pick<ParsedMessage, "threadId" | "senderId" | "isSelf">,
  now: Date = new Date(),
): NotebookLmGuardCheck {
  const allowEveryone = getTuning("NOTEBOOKLM_ALLOW_EVERYONE");
  if (!allowEveryone && !laChuBot(account, message)) {
    return {
      ok: false,
      reason:
        "Công cụ NotebookLM hiện chỉ cho phép chủ bot sử dụng. " +
        "Nếu muốn mở cho mọi người, hãy bật công tắc 'NotebookLM: mọi người dùng được' trong Cấu hình > Tạo file tài liệu.",
    };
  }

  const tz = botTimeZone();
  const dayKey = todayKey(tz, now);
  const cutoff = new Date(now.getTime() - COUNTER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keepSince = todayKey(tz, cutoff);
  const maxPerDay = getTuning("NOTEBOOKLM_MAX_PER_DAY");

  const reserved = tryReserveNotebookLmSlot(
    account.id,
    message.threadId,
    dayKey,
    maxPerDay,
    keepSince,
  );
  if (!reserved) {
    return {
      ok: false,
      reason: `Cuộc trò chuyện này đã dùng hết trần ${maxPerDay} lượt NotebookLM trong hôm nay (theo giờ ${tz}). Hãy thử lại vào ngày mai hoặc nâng trần ở Cấu hình > Tạo file tài liệu.`,
    };
  }

  return { ok: true, dayKey };
}

export function hoanSuatNotebookLm(accountId: string, threadId: string, dayKey: string): void {
  refundNotebookLmSlot(accountId, threadId, dayKey);
}
