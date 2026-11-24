import { db } from "../conversation/database.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

export type InventoryMessageKey = { accountId: string; threadId: string; msgId: string };
export type InventoryRecall = InventoryMessageKey & {
  recalledAt: string;
  senderId: string;
  rawMessage: string;
  sentAt: string;
};

const remember = db.prepare(`
  INSERT INTO inventory_message_sources
    (account_id, thread_id, msg_id, cli_msg_id, sender_id, sender_name, raw_message, sent_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (account_id, thread_id, msg_id) DO UPDATE SET
    cli_msg_id = excluded.cli_msg_id, sender_id = excluded.sender_id,
    sender_name = excluded.sender_name, raw_message = excluded.raw_message, sent_at = excluded.sent_at
`);

export function rememberInventoryMessage(msg: Pick<ParsedMessage,
  "accountId" | "threadId" | "msgId" | "cliMsgId" | "senderId" | "senderName" | "text" | "sentAt">): void {
  if (!msg.accountId || !msg.threadId || !msg.msgId) return;
  remember.run(msg.accountId, msg.threadId, msg.msgId, msg.cliMsgId || "", msg.senderId || "",
    msg.senderName || "", msg.text || "", msg.sentAt || "");
}

const recalled = db.prepare(`
  SELECT recalled_at FROM inventory_message_sources WHERE account_id = ? AND thread_id = ? AND msg_id = ?
`);

export function isInventoryMessageRecalled(key: InventoryMessageKey): boolean {
  if (!key.accountId || !key.threadId || !key.msgId) return false;
  return Boolean((recalled.get(key.accountId, key.threadId, key.msgId) as { recalled_at: string | null } | undefined)?.recalled_at);
}

const recall = db.prepare(`
  INSERT INTO inventory_message_sources (account_id, thread_id, msg_id, recalled_at, recall_pending)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT (account_id, thread_id, msg_id) DO UPDATE SET
    recalled_at = COALESCE(inventory_message_sources.recalled_at, excluded.recalled_at), recall_pending = 1
`);

export function recallInventoryMessage(key: InventoryMessageKey, recalledAt: string): void {
  if (!key.accountId || !key.threadId || !key.msgId) return;
  recall.run(key.accountId, key.threadId, key.msgId, recalledAt);
}

export function pendingInventoryRecalls(): InventoryRecall[] {
  const rows = db.prepare(`
    SELECT account_id, thread_id, msg_id, recalled_at, sender_id, raw_message, sent_at
    FROM inventory_message_sources WHERE recall_pending = 1 LIMIT 100
  `).all() as { account_id: string; thread_id: string; msg_id: string; recalled_at: string;
    sender_id: string; raw_message: string; sent_at: string }[];
  return rows.map((r) => ({ accountId: r.account_id, threadId: r.thread_id, msgId: r.msg_id,
    recalledAt: r.recalled_at, senderId: r.sender_id, rawMessage: r.raw_message, sentAt: r.sent_at }));
}

export function acknowledgeInventoryRecall(key: InventoryMessageKey): void {
  db.prepare(`UPDATE inventory_message_sources SET recall_pending = 0
    WHERE account_id = ? AND thread_id = ? AND msg_id = ?`).run(key.accountId, key.threadId, key.msgId);
}
