import type { DatabaseSync } from "node:sqlite";

export function createInventoryMessageTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_message_sources (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      msg_id TEXT NOT NULL,
      cli_msg_id TEXT NOT NULL DEFAULT '',
      sender_id TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      raw_message TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      recalled_at TEXT,
      recall_pending INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, thread_id, msg_id)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_recalls_pending
      ON inventory_message_sources (recall_pending);
  `);
}
