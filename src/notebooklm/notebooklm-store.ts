import { db } from "../conversation/database.js";

/**
 * Lưu trữ ánh xạ sổ tay NotebookLM theo từng cuộc trò chuyện `(accountId, threadId)`
 * và bộ đếm trần mỗi ngày `notebooklm_daily_counters`.
 */

export type ThreadNotebook = {
  accountId: string;
  threadId: string;
  notebookId: string;
  notebookUrl: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ThreadNotebookRow = {
  account_id: string;
  thread_id: string;
  notebook_id: string;
  notebook_url: string;
  title: string;
  created_at: string;
  updated_at: string;
};

const getNotebookStmt = db.prepare(`
  SELECT account_id, thread_id, notebook_id, notebook_url, title, created_at, updated_at
  FROM thread_notebooks
  WHERE account_id = ? AND thread_id = ?
`);

const upsertNotebookStmt = db.prepare(`
  INSERT INTO thread_notebooks (account_id, thread_id, notebook_id, notebook_url, title)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (account_id, thread_id) DO UPDATE SET
    notebook_id  = excluded.notebook_id,
    notebook_url = excluded.notebook_url,
    title        = excluded.title,
    updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ','now')
`);

const deleteNotebookStmt = db.prepare(`
  DELETE FROM thread_notebooks WHERE account_id = ? AND thread_id = ?
`);

export function getThreadNotebook(accountId: string, threadId: string): ThreadNotebook | null {
  const row = getNotebookStmt.get(accountId, threadId) as ThreadNotebookRow | undefined;
  if (!row) return null;
  return {
    accountId: row.account_id,
    threadId: row.thread_id,
    notebookId: row.notebook_id,
    notebookUrl: row.notebook_url,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveThreadNotebook(input: {
  accountId: string;
  threadId: string;
  notebookId: string;
  notebookUrl: string;
  title: string;
}): ThreadNotebook {
  upsertNotebookStmt.run(
    input.accountId,
    input.threadId,
    input.notebookId,
    input.notebookUrl,
    input.title,
  );
  return getThreadNotebook(input.accountId, input.threadId)!;
}

export function deleteThreadNotebook(accountId: string, threadId: string): void {
  deleteNotebookStmt.run(accountId, threadId);
}

const getCountStmt = db.prepare(`
  SELECT count FROM notebooklm_daily_counters
  WHERE account_id = ? AND thread_id = ? AND day_key = ?
`);

const tryReserveSlotStmt = db.prepare(`
  INSERT INTO notebooklm_daily_counters (account_id, thread_id, day_key, count)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (account_id, thread_id, day_key) DO UPDATE SET
    count = count + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE count < ?
`);

const refundSlotStmt = db.prepare(`
  UPDATE notebooklm_daily_counters
  SET count = MAX(0, count - 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE account_id = ? AND thread_id = ? AND day_key = ?
`);

const pruneOldCountersStmt = db.prepare(`
  DELETE FROM notebooklm_daily_counters WHERE day_key < ?
`);

export function getNotebookLmDailyCount(
  accountId: string,
  threadId: string,
  dayKey: string,
): number {
  const row = getCountStmt.get(accountId, threadId, dayKey) as { count: number } | undefined;
  return row ? row.count : 0;
}

/**
 * Giành 1 suất nguyên tử trong ngày `dayKey` nếu `count < max`.
 * Trả `true` khi giành được suất, `false` khi đã chạm trần `max`.
 */
export function tryReserveNotebookLmSlot(
  accountId: string,
  threadId: string,
  dayKey: string,
  max: number,
  keepSinceDayKey?: string,
): boolean {
  const changed = tryReserveSlotStmt.run(accountId, threadId, dayKey, max).changes > 0;
  if (changed && keepSinceDayKey) {
    pruneOldCountersStmt.run(keepSinceDayKey);
  }
  return changed;
}

export function refundNotebookLmSlot(accountId: string, threadId: string, dayKey: string): void {
  refundSlotStmt.run(accountId, threadId, dayKey);
}

/** Chỉ dùng cho test - xóa sạch bảng ánh xạ và bộ đếm */
export function resetNotebookLmStore(): void {
  db.exec("DELETE FROM thread_notebooks; DELETE FROM notebooklm_daily_counters;");
}
