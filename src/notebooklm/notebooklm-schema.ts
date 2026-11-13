import type { DatabaseSync } from "node:sqlite";

/**
 * Lược đồ cho tích hợp NotebookLM (mục 14.4):
 * - `thread_notebooks`: ánh xạ mỗi cuộc trò chuyện (account_id, thread_id) với
 *   một sổ tay NotebookLM riêng biệt để tài liệu và hỏi đáp không lẫn giữa các
 *   cuộc chat.
 * - `notebooklm_daily_counters`: đếm số lượt gọi công cụ notebooklm mỗi ngày
 *   theo (account_id, thread_id, day_key), bền qua các lần khởi động lại.
 */
export function taoBangNotebookLm(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_notebooks (
      account_id   TEXT NOT NULL,
      thread_id    TEXT NOT NULL,
      notebook_id  TEXT NOT NULL,
      notebook_url TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (account_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS notebooklm_daily_counters (
      account_id TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      day_key    TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (account_id, thread_id, day_key)
    );
  `);
}
