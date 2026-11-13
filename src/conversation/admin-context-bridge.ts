import { db } from "./database.js";
import type { StoredMessage } from "./history-store.js";

function parseImages(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}

export type AdminThreadInfo = {
  threadId: string;
  displayName: string;
};

/**
 * Tìm thread 1-1 của Quản trị viên (Admin) cho một tài khoản.
 * Ưu tiên:
 * 1. Thread 1-1 có thread_id nằm trong allowlistUserIds.
 * 2. Thread 1-1 có display_name chứa từ khóa "Khoa" hoặc "Admin".
 * 3. Thread 1-1 có hoạt động gần đây nhất.
 */
export function findAdminThread(
  accountId: string,
  allowlistUserIds: string[] = [],
): AdminThreadInfo | null {
  type Row = { thread_id: string; display_name: string };

  if (allowlistUserIds.length > 0) {
    const placeholders = allowlistUserIds.map(() => "?").join(",");
    const row = db
      .prepare(
        `SELECT thread_id, display_name FROM threads
         WHERE account_id = ? AND thread_type = 0 AND thread_id IN (${placeholders})
         ORDER BY last_message_at DESC LIMIT 1`,
      )
      .get(accountId, ...allowlistUserIds) as Row | undefined;

    if (row) return { threadId: row.thread_id, displayName: row.display_name };
  }

  // Fallback: Tìm theo tên Admin quen thuộc
  const byNameRow = db
    .prepare(
      `SELECT thread_id, display_name FROM threads
       WHERE account_id = ? AND thread_type = 0
         AND (display_name LIKE '%Khoa%' OR display_name LIKE '%Admin%')
       ORDER BY last_message_at DESC LIMIT 1`,
    )
    .get(accountId) as Row | undefined;

  if (byNameRow) return { threadId: byNameRow.thread_id, displayName: byNameRow.display_name };

  // Fallback cuối: Thread 1-1 có tương tác gần nhất
  const latestRow = db
    .prepare(
      `SELECT thread_id, display_name FROM threads
       WHERE account_id = ? AND thread_type = 0
       ORDER BY last_message_at DESC LIMIT 1`,
    )
    .get(accountId) as Row | undefined;

  return latestRow ? { threadId: latestRow.thread_id, displayName: latestRow.display_name } : null;
}

/**
 * Lấy danh sách tin nhắn gần nhất từ cuộc trò chuyện riêng của Admin.
 * Sắp xếp theo thứ tự thời gian tăng dần (cũ trước, mới sau).
 */
export function getAdminContextMessages(
  accountId: string,
  adminThreadId: string,
  limit = 10,
): StoredMessage[] {
  type Row = {
    id: number;
    account_id: string;
    thread_id: string;
    role: "user" | "assistant";
    sender_id: string | null;
    sender_name: string | null;
    content: string;
    images: string | null;
    created_at: string;
  };

  const rows = db
    .prepare(
      `SELECT id, account_id, thread_id, role, sender_id, sender_name, content, images, created_at
       FROM messages
       WHERE account_id = ? AND thread_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(accountId, adminThreadId, Math.max(1, limit)) as unknown as Row[];

  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      role: r.role,
      senderId: r.sender_id ?? undefined,
      senderName: r.sender_name ?? undefined,
      content: r.content,
      images: parseImages(r.images),
      createdAt: r.created_at,
    }));
}

function rutGonNoiDung(text: string, maxLen = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

function formatThoiGian(isoString: string): string {
  try {
    const d = new Date(isoString);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month} ${hours}:${minutes}`;
  } catch {
    return "";
  }
}

/**
 * Định dạng các tin nhắn trao đổi của Admin thành khối ngữ cảnh chỉ đạo có ranh giới rõ ràng.
 */
export function formatAdminContextBlock(
  adminMessages: StoredMessage[],
  adminDisplayName = "Admin",
): string {
  if (adminMessages.length === 0) return "";

  const lines = adminMessages.map((m) => {
    const time = m.createdAt ? formatThoiGian(m.createdAt) : "";
    const timePrefix = time ? `[${time}] ` : "";
    if (m.role === "user") {
      const name = m.senderName || adminDisplayName;
      return `- ${timePrefix}Quản trị viên (${name}): "${rutGonNoiDung(m.content)}"`;
    }
    return `- ${timePrefix}Bot (trả lời Quản trị viên): "${rutGonNoiDung(m.content)}"`;
  });

  return [
    `<chi_dao_admin>`,
    `[THÔNG TIN & CHỈ ĐẠO TỪ CHAT RIÊNG CỦA QUẢN TRỊ VIÊN (${adminDisplayName})]`,
    `Dưới đây là các trao đổi và chỉ đạo gần nhất giữa Quản trị viên và bạn trong cuộc trò chuyện 1-1 riêng tư:`,
    ...lines,
    `LƯU Ý: Đây là bối cảnh chỉ đạo nội bộ từ Admin để bạn phục vụ tốt hơn khi trả lời trong nhóm. Bạn hãy áp dụng thông tin, bảng giá, hướng dẫn trên một cách tự nhiên. TUYỆT ĐỐI không chia sẻ thông tin bí mật cá nhân của Admin nếu không cần thiết.`,
    `</chi_dao_admin>`,
  ].join("\n");
}

/**
 * Hàm tiện ích lấy trực tiếp khối chỉ đạo Admin cho một nhóm nếu nhóm được bật liên thông.
 */
export function getAdminSharedContextForGroup(params: {
  accountId: string;
  allowlistUserIds?: string[];
  limit?: number;
}): string {
  const adminThread = findAdminThread(params.accountId, params.allowlistUserIds);
  if (!adminThread) return "";

  const messages = getAdminContextMessages(params.accountId, adminThread.threadId, params.limit ?? 10);
  return formatAdminContextBlock(messages, adminThread.displayName || "Admin");
}
