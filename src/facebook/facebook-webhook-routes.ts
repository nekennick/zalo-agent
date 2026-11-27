import { Hono } from "hono";
import { env } from "../config/env.js";
import { createLogger } from "../shared/logger.js";
import { markStaffReplied, processFacebookMessage } from "./facebook-turn-processor.js";
import type { FacebookWebhookPayload } from "./facebook-types.js";

const log = createLogger("facebook-webhook");

export const facebookWebhookRoutes = new Hono();

/**
 * GET /webhook/facebook
 * Meta gọi tới để xác thực webhook (Verify Token Challenge).
 */
facebookWebhookRoutes.get("/", (c) => {
  const query = c.req.query();
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  const expectedToken = env.FACEBOOK_VERIFY_TOKEN || "yagami_facebook_webhook_2026";

  if (mode === "subscribe" && token === expectedToken) {
    log.info("Meta Webhook xác thực thành công!");
    return c.text(challenge ?? "", 200);
  }

  log.warn({ mode, tokenReceived: token }, "Meta Webhook xác thực thất bại: Sai Verify Token");
  return c.text("Forbidden", 403);
});

/**
 * POST /webhook/facebook
 * Meta đẩy sự kiện tin nhắn từ người dùng hoặc nhân viên trực page.
 */
facebookWebhookRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as FacebookWebhookPayload | null;
  log.info({ object: body?.object, entries: body?.entry?.length }, "Nhận sự kiện POST từ Meta Webhook");

  if (!body || body.object !== "page") {
    return c.json({ status: "ignored" }, 200);
  }

  // Meta yêu cầu phản hồi HTTP 200 trong vòng 20 giây để không bị retry hoặc báo lỗi endpoint
  // Do đó, ta duyệt và kích hoạt xử lý async ở chế độ nền (fire-and-forget).
  const pageAccessToken = env.FACEBOOK_PAGE_ACCESS_TOKEN || "";

  if (body.entry && Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      const pageId = entry.id;
      if (!entry.messaging || !Array.isArray(entry.messaging)) continue;

      for (const item of entry.messaging) {
        // 1. Nếu là sự kiện echo (nhân viên page gõ trả lời trực tiếp cho khách)
        // Lưu ý: Nếu tin do chính Bot gửi qua Graph API thì Meta luôn gửi kèm `app_id`.
        // Ta CHỈ kích hoạt Human Handoff khi tin nhắn do nhân viên trực gõ từ Meta Business Suite / Web (không có app_id).
        if (item.message?.is_echo) {
          if (!item.message.app_id) {
            const customerPsid = item.recipient.id;
            markStaffReplied(pageId, customerPsid);
          }
          continue;
        }

        // 2. Nếu là tin nhắn từ khách hàng gửi tới (chữ hoặc đính kèm ảnh/tập tin)
        const hasText = Boolean(item.message?.text?.trim());
        const hasAttachments = Boolean(item.message?.attachments && item.message.attachments.length > 0);
        if (item.message && (hasText || hasAttachments) && pageAccessToken) {
          void processFacebookMessage({
            pageId,
            pageAccessToken,
            item,
          });
        }
      }
    }
  }

  return c.json({ status: "EVENT_RECEIVED" }, 200);
});
