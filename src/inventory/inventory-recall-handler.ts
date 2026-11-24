import type { Undo } from "zca-js";
import { isWarehouseThread } from "../middleware/allowlist-filter.js";
import { createLogger } from "../shared/logger.js";
import { sendInventoryDashboard } from "./inventory-dashboard-client.js";
import { acknowledgeInventoryRecall, pendingInventoryRecalls, recallInventoryMessage } from "./inventory-message-store.js";

const log = createLogger("inventory-recall");
let flushing: Promise<void> | undefined;

export function handleInventoryUndo(accountId: string, event: Undo): Promise<void> {
  if (!event.isGroup || !isWarehouseThread(event.threadId)) return Promise.resolve();
  // msgId của sự kiện undo khác mã tin bị thu hồi nằm trong content.
  const msgId = String(event.data.content?.globalMsgId ?? "");
  if (!msgId || msgId === "0") return Promise.resolve();
  recallInventoryMessage({ accountId, threadId: event.threadId, msgId }, new Date().toISOString());
  return flushInventoryRecalls();
}

export function flushInventoryRecalls(): Promise<void> {
  if (flushing) return flushing;
  flushing = deliverRecalls()
    .catch((err) => { log.error({ err }, "Chưa đọc được hàng đợi thu hồi - sẽ thử lại"); })
    .finally(() => { flushing = undefined; });
  return flushing;
}

async function deliverRecalls(): Promise<void> {
  for (const recall of pendingInventoryRecalls()) {
    try {
      const ok = await sendInventoryDashboard({
        action: "RECALL_SOURCE",
        sourceAccountId: recall.accountId,
        threadId: recall.threadId,
        sourceMessageId: recall.msgId,
        recalledAt: recall.recalledAt,
        senderId: recall.senderId,
        rawMessage: recall.rawMessage,
        sentAt: recall.sentAt,
      }, "PATCH");
      if (ok) acknowledgeInventoryRecall(recall);
      else log.warn({ msgId: recall.msgId }, "Dashboard chưa xác nhận thu hồi - giữ hàng đợi để thử lại");
    } catch (err) {
      log.warn({ err, msgId: recall.msgId }, "Chưa gửi được tin thu hồi - sẽ thử lại");
    }
  }
}

export function startInventoryRecallWorker(): () => void {
  void flushInventoryRecalls();
  const timer = setInterval(() => { void flushInventoryRecalls(); }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
