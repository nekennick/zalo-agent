import { db } from "../conversation/database.js";
import { decryptSecret, encryptSecret, maskSecret } from "../config/secret-cipher.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("facebook-tenant-store");

export type PageStatus = "active" | "paused" | "expired";
export type PagePlan = "basic" | "pro" | "unlimited";

export type FacebookPageRecord = {
  pageId: string;
  pageName: string;
  accessToken: string; // Token thô đã giải mã (dùng nội bộ khi gọi Graph API)
  agentId: string;
  status: PageStatus;
  planName: PagePlan;
  messagesQuota: number;
  messagesUsed: number;
  cycleStartAt: string;
  cycleEndAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FacebookPagePublicView = Omit<FacebookPageRecord, "accessToken"> & {
  maskedToken: string;
  isExpired: boolean;
  isQuotaExceeded: boolean;
  daysRemaining: number;
};

type Row = {
  page_id: string;
  page_name: string;
  access_token: string;
  agent_id: string;
  status: string;
  plan_name: string;
  messages_quota: number;
  messages_used: number;
  cycle_start_at: string;
  cycle_end_at: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: Row): FacebookPageRecord {
  let token = "";
  try {
    token = decryptSecret(row.access_token);
  } catch (err) {
    log.error({ err, pageId: row.page_id }, "Không thể giải mã Page Access Token");
  }

  return {
    pageId: row.page_id,
    pageName: row.page_name,
    accessToken: token,
    agentId: row.agent_id,
    status: row.status as PageStatus,
    planName: row.plan_name as PagePlan,
    messagesQuota: row.messages_quota,
    messagesUsed: row.messages_used,
    cycleStartAt: row.cycle_start_at,
    cycleEndAt: row.cycle_end_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicView(page: FacebookPageRecord): FacebookPagePublicView {
  const now = Date.now();
  const end = new Date(page.cycleEndAt).getTime();
  const daysRemaining = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
  const isExpired = now > end || page.status === "expired";
  const isQuotaExceeded = page.messagesQuota > 0 && page.messagesUsed >= page.messagesQuota;

  const { accessToken, ...rest } = page;
  return {
    ...rest,
    maskedToken: maskSecret(accessToken),
    isExpired,
    isQuotaExceeded,
    daysRemaining,
  };
}

/**
 * Lấy cấu hình Page theo Page ID (kèm token đã giải mã để gọi API).
 */
export function getFacebookPage(pageId: string): FacebookPageRecord | null {
  const row = db.prepare("SELECT * FROM facebook_pages WHERE page_id = ?").get(pageId) as Row | undefined;
  if (!row) return null;
  return mapRow(row);
}

/**
 * Lấy toàn bộ danh sách Page (dạng public view cho Web Dashboard).
 */
export function listFacebookPages(): FacebookPagePublicView[] {
  const rows = db.prepare("SELECT * FROM facebook_pages ORDER BY created_at DESC").all() as Row[];
  return rows.map((r) => toPublicView(mapRow(r)));
}

/**
 * Thêm hoặc cập nhật một Fanpage.
 */
export function saveFacebookPage(input: {
  pageId: string;
  pageName: string;
  accessToken: string;
  agentId: string;
  planName?: PagePlan;
  messagesQuota?: number;
  durationDays?: number;
}): FacebookPageRecord {
  const {
    pageId,
    pageName,
    accessToken,
    agentId,
    planName = "basic",
    messagesQuota = planName === "pro" ? 10000 : planName === "unlimited" ? 0 : 2000,
    durationDays = 30,
  } = input;

  const now = new Date();
  const cycleEndAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const encrypted = encryptSecret(accessToken);

  db.prepare(`
    INSERT INTO facebook_pages (
      page_id, page_name, access_token, agent_id, status, plan_name,
      messages_quota, messages_used, cycle_start_at, cycle_end_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      page_name = excluded.page_name,
      access_token = excluded.access_token,
      agent_id = excluded.agent_id,
      plan_name = excluded.plan_name,
      messages_quota = excluded.messages_quota,
      updated_at = excluded.updated_at
  `).run(
    pageId,
    pageName,
    encrypted,
    agentId,
    planName,
    messagesQuota,
    now.toISOString(),
    cycleEndAt,
    now.toISOString(),
  );

  return getFacebookPage(pageId)!;
}

/**
 * Đổi trạng thái Page ('active' | 'paused' | 'expired').
 */
export function updateFacebookPageStatus(pageId: string, status: PageStatus): void {
  db.prepare("UPDATE facebook_pages SET status = ?, updated_at = ? WHERE page_id = ?").run(
    status,
    new Date().toISOString(),
    pageId,
  );
}

/**
 * Kiểm tra hạn mức và cộng 1 lượt tin nhắn khi bot gửi phản hồi.
 */
export function checkAndIncrementUsage(pageId: string): {
  allowed: boolean;
  reason?: "EXPIRED" | "QUOTA_EXCEEDED" | "PAUSED" | "NOT_FOUND";
  used: number;
  quota: number;
} {
  const page = getFacebookPage(pageId);
  if (!page) {
    return { allowed: false, reason: "NOT_FOUND", used: 0, quota: 0 };
  }

  if (page.status === "paused") {
    return { allowed: false, reason: "PAUSED", used: page.messagesUsed, quota: page.messagesQuota };
  }

  const now = Date.now();
  const end = new Date(page.cycleEndAt).getTime();
  if (now > end || page.status === "expired") {
    if (page.status !== "expired") {
      updateFacebookPageStatus(pageId, "expired");
    }
    return { allowed: false, reason: "EXPIRED", used: page.messagesUsed, quota: page.messagesQuota };
  }

  if (page.messagesQuota > 0 && page.messagesUsed >= page.messagesQuota) {
    return { allowed: false, reason: "QUOTA_EXCEEDED", used: page.messagesUsed, quota: page.messagesQuota };
  }

  // Tăng 1 lượt tin nhắn
  const newUsed = page.messagesUsed + 1;
  db.prepare("UPDATE facebook_pages SET messages_used = ?, updated_at = ? WHERE page_id = ?").run(
    newUsed,
    new Date().toISOString(),
    pageId,
  );

  return { allowed: true, used: newUsed, quota: page.messagesQuota };
}

/**
 * Gia hạn thời hạn sử dụng và reset hạn mức tin nhắn theo chu kỳ mới (qua thanh toán VietQR).
 */
export function extendFacebookSubscription(params: {
  pageId: string;
  additionalDays: number;
  planName?: PagePlan;
}): { success: boolean; newEndAt: string; planName: string } {
  const { pageId, additionalDays, planName } = params;
  const page = getFacebookPage(pageId);
  if (!page) return { success: false, newEndAt: "", planName: "" };

  const now = Date.now();
  const currentEnd = new Date(page.cycleEndAt).getTime();
  const baseTime = currentEnd > now ? currentEnd : now;
  const newEnd = new Date(baseTime + additionalDays * 24 * 60 * 60 * 1000).toISOString();

  const newPlan = planName || page.planName;
  const newQuota = newPlan === "pro" ? 10000 : newPlan === "unlimited" ? 0 : 2000;

  db.prepare(`
    UPDATE facebook_pages
    SET status = 'active',
        plan_name = ?,
        messages_quota = ?,
        messages_used = 0,
        cycle_start_at = ?,
        cycle_end_at = ?,
        updated_at = ?
    WHERE page_id = ?
  `).run(
    newPlan,
    newQuota,
    new Date().toISOString(),
    newEnd,
    new Date().toISOString(),
    pageId,
  );

  log.info({ pageId, additionalDays, newEnd, newPlan }, "Đã gia hạn thuê bao Fanpage thành công");
  return { success: true, newEndAt: newEnd, planName: newPlan };
}

/**
 * Xóa một Fanpage khỏi hệ thống SaaS.
 */
export function deleteFacebookPage(pageId: string): boolean {
  const res = db.prepare("DELETE FROM facebook_pages WHERE page_id = ?").run(pageId);
  return res.changes > 0;
}
