import { Hono } from "hono";
import { z } from "zod";
import { createLogger } from "../shared/logger.js";
import {
  deleteFacebookPage,
  extendFacebookSubscription,
  getFacebookPage,
  listFacebookPages,
  saveFacebookPage,
  updateFacebookPageStatus,
  type PagePlan,
  type PageStatus,
} from "./facebook-tenant-store.js";

const log = createLogger("facebook-page-routes");
export const facebookPageRoutes = new Hono();

const createPageSchema = z.object({
  pageId: z.string().min(1, "Page ID không được để trống"),
  pageName: z.string().min(1, "Tên Fanpage không được để trống"),
  accessToken: z.string().min(10, "Page Access Token không hợp lệ"),
  agentId: z.string().min(1, "Vui lòng chọn Agent phụ trách"),
  planName: z.enum(["basic", "pro", "unlimited"]).default("basic"),
  durationDays: z.coerce.number().int().min(1).default(30),
});

const updatePageSchema = z.object({
  status: z.enum(["active", "paused", "expired"]).optional(),
  agentId: z.string().optional(),
  planName: z.enum(["basic", "pro", "unlimited"]).optional(),
});

const extendSubscriptionSchema = z.object({
  additionalDays: z.coerce.number().int().min(1).default(30),
  planName: z.enum(["basic", "pro", "unlimited"]).optional(),
});

/**
 * Gọi Meta Graph API để đăng ký Webhook Subscription cho Fanpage mới
 */
async function subscribePageToWebhook(pageId: string, accessToken: string): Promise<boolean> {
  try {
    const url = `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?subscribed_fields=messages,message_echoes&access_token=${accessToken}`;
    const res = await fetch(url, { method: "POST" });
    const data = (await res.json()) as { success?: boolean; error?: { message: string } };
    if (data.success) {
      log.info({ pageId }, "Đã kích hoạt subscribed_apps thành công với Meta");
      return true;
    }
    log.error({ pageId, error: data.error }, "Lỗi khi gọi subscribed_apps từ Meta");
    return false;
  } catch (err) {
    log.error({ pageId, err }, "Lỗi mạng khi gọi subscribed_apps tới Meta");
    return false;
  }
}

/**
 * GET /api/facebook/pages
 * Danh sách toàn bộ Fanpages kèm thông tin gói cước và usage.
 */
facebookPageRoutes.get("/pages", (c) => {
  const pages = listFacebookPages();
  return c.json({ ok: true, data: pages });
});

/**
 * POST /api/facebook/pages
 * Thêm một Fanpage mới vào hệ thống SaaS.
 */
facebookPageRoutes.post("/pages", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" }, 400);
  }

  const { pageId, pageName, accessToken, agentId, planName, durationDays } = parsed.data;

  // Tự động kích hoạt Webhook Subscription trên Meta
  const subscribed = await subscribePageToWebhook(pageId, accessToken);
  if (!subscribed) {
    log.warn({ pageId }, "Không thể tự động kích hoạt webhook subscription, nhưng vẫn lưu cấu hình Page");
  }

  const saved = saveFacebookPage({
    pageId,
    pageName,
    accessToken,
    agentId,
    planName,
    durationDays,
  });

  return c.json({ ok: true, data: saved });
});

/**
 * PATCH /api/facebook/pages/:id
 * Cập nhật trạng thái hoặc gói cước của Fanpage.
 */
facebookPageRoutes.patch("/pages/:id", async (c) => {
  const pageId = c.req.param("id");
  const existing = getFacebookPage(pageId);
  if (!existing) {
    return c.json({ ok: false, error: "Không tìm thấy Fanpage" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updatePageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Dữ liệu cập nhật không hợp lệ" }, 400);
  }

  if (parsed.data.status) {
    updateFacebookPageStatus(pageId, parsed.data.status as PageStatus);
  }

  if (parsed.data.agentId || parsed.data.planName) {
    saveFacebookPage({
      pageId: existing.pageId,
      pageName: existing.pageName,
      accessToken: existing.accessToken,
      agentId: parsed.data.agentId || existing.agentId,
      planName: (parsed.data.planName as PagePlan) || existing.planName,
    });
  }

  const updated = getFacebookPage(pageId);
  return c.json({ ok: true, data: updated });
});

/**
 * POST /api/facebook/pages/:id/extend
 * Gia hạn thời gian sử dụng và reset hạn mức tin nhắn theo tháng (VietQR Billing).
 */
facebookPageRoutes.post("/pages/:id/extend", async (c) => {
  const pageId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = extendSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Dữ liệu gia hạn không hợp lệ" }, 400);
  }

  const res = extendFacebookSubscription({
    pageId,
    additionalDays: parsed.data.additionalDays,
    planName: parsed.data.planName,
  });

  if (!res.success) {
    return c.json({ ok: false, error: "Không tìm thấy Fanpage để gia hạn" }, 404);
  }

  return c.json({ ok: true, data: res });
});

/**
 * DELETE /api/facebook/pages/:id
 * Xóa Fanpage khỏi hệ thống.
 */
facebookPageRoutes.delete("/pages/:id", (c) => {
  const pageId = c.req.param("id");
  const deleted = deleteFacebookPage(pageId);
  if (!deleted) {
    return c.json({ ok: false, error: "Không tìm thấy Fanpage để xóa" }, 404);
  }
  return c.json({ ok: true, message: "Đã xóa Fanpage thành công" });
});
