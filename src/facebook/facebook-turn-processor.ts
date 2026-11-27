import { runAgentTurn } from "../agent/agent-loop.js";
import type { StepTrace } from "../agent/agent-step-trace.js";
import { listEnabledAccounts } from "../config/account-store.js";
import { ensureDefaultAgent } from "../config/agent-store.js";
import type { AccountConfig } from "../config/account-store.js";
import { appendMessage } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { ThreadType } from "zca-js";
import { imagePathsOf, persistBatchImages } from "../conversation/media-store.js";
import type { IncomingImage, ParsedMessage } from "../zalo/zalo-message-parser.js";
import { sendFacebookMessage, sendFacebookTyping } from "./facebook-api-client.js";
import { applyFacebookGuardrail } from "./facebook-guardrail.js";
import { checkAndIncrementUsage, getFacebookPage } from "./facebook-tenant-store.js";
import type { FacebookMessagingItem } from "./facebook-types.js";

const log = createLogger("facebook-processor");

/**
 * Quản lý Human Handoff: Khi nhân viên trực Page trả lời khách bằng tay
 * (Meta bắn sự kiện `message.is_echo = true`), bot sẽ tự động ngưng can thiệp
 * trong vòng 30 phút để tránh trả lời chồng chéo lên nhân viên.
 */
const staffActiveUntil = new Map<string, number>();
const HANDOFF_PAUSE_MS = 30 * 60 * 1000; // 30 phút

export function markStaffReplied(pageId: string, customerPsid: string): void {
  const key = `${pageId}:${customerPsid}`;
  staffActiveUntil.set(key, Date.now() + HANDOFF_PAUSE_MS);
  log.info({ pageId, customerPsid }, "Nhân viên vừa trả lời khách - tạm dừng bot 30 phút");
}

export function isStaffHandling(pageId: string, customerPsid: string): boolean {
  const key = `${pageId}:${customerPsid}`;
  const until = staffActiveUntil.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    staffActiveUntil.delete(key);
    return false;
  }
  return true;
}

function resolveFacebookAccount(agentIdOverride?: string): AccountConfig {
  const accounts = listEnabledAccounts();
  const matched = accounts.find((a) => a.id === "facebook" || a.id === "cskh") ?? accounts[0];
  const targetAgentId = agentIdOverride || (matched ? matched.agentId : ensureDefaultAgent().id);
  if (matched) {
    return {
      ...matched,
      id: "facebook",
      label: matched.label ? `Facebook (${matched.label})` : "Facebook Messenger",
      loai: "bot",
      agentId: targetAgentId,
    };
  }

  return {
    id: "facebook",
    label: "Facebook Messenger",
    loai: "bot",
    coBotToken: false,
    enabled: true,
    agentId: targetAgentId,
    allowlist: { mode: "all", userIds: [] },
    groupRequireMention: false,
    respondToGroups: false,
    groupPassiveListen: false,
    autoReactEnabled: false,
    autoReactIcon: "",
    typingIndicatorEnabled: true,
    disabledTools: [],
    autoAcceptFriends: false,
    autoAcceptFriendDelayMinutes: 0,
  };
}

/**
 * Xử lý một tin nhắn từ khách hàng Facebook Messenger:
 * Chuẩn hóa tin -> Gọi Agent Loop -> Ghi history -> Gửi câu trả lời qua Graph API.
 */
export async function processFacebookMessage(params: {
  pageId: string;
  pageAccessToken: string;
  item: FacebookMessagingItem;
}): Promise<void> {
  const { pageId, pageAccessToken, item } = params;
  const senderPsid = item.sender.id;
  const rawText = item.message?.text?.trim() ?? "";

  // 1. Trích xuất danh sách ảnh đính kèm từ Meta webhook
  const rawAttachments = item.message?.attachments ?? [];
  const imageAttachments = rawAttachments.filter((att) => att.type === "image" && att.payload?.url);
  const incomingImages: IncomingImage[] = imageAttachments.map((att) => ({
    url: att.payload.url!,
  }));

  // Bỏ qua nếu không có cả chữ lẫn ảnh
  if (!rawText && incomingImages.length === 0) return;

  const messageText = rawText || `[gửi kèm ${incomingImages.length} ảnh]`;

  log.info(
    { pageId, senderPsid, text: messageText, imagesCount: incomingImages.length },
    "Bắt đầu xử lý tin nhắn từ khách Facebook Messenger",
  );

  // Kiểm tra Human Handoff: nếu nhân viên đang trực, bot im lặng
  if (isStaffHandling(pageId, senderPsid)) {
    log.debug({ pageId, senderPsid }, "Nhân viên đang trực - bot bỏ qua tin này");
    return;
  }

  // Tra cứu cấu hình Fanpage từ Tenant Store (Multi-tenant SaaS)
  const pageTenant = getFacebookPage(pageId);
  const effectiveToken = pageTenant?.accessToken || pageAccessToken;

  // 1. Kiểm tra trạng thái thuê bao SaaS
  if (pageTenant) {
    if (pageTenant.status === "paused" || pageTenant.status === "expired") {
      log.info({ pageId, status: pageTenant.status }, "Fanpage đang tạm dừng hoặc hết hạn thuê bao - bỏ qua");
      return;
    }

    if (pageTenant.messagesQuota > 0 && pageTenant.messagesUsed >= pageTenant.messagesQuota) {
      log.warn({ pageId, used: pageTenant.messagesUsed, quota: pageTenant.messagesQuota }, "Fanpage chạm trần hạn mức tin nhắn tháng");
      await sendFacebookMessage({
        pageAccessToken: effectiveToken,
        recipientPsid: senderPsid,
        text: "Dạ hiện tại kênh chat tự động của shop đã đạt hạn mức tin nhắn trong tháng. Quý khách vui lòng để lại lời nhắn, nhân viên của shop sẽ phản hồi sớm nhất nhé ạ!",
      });
      return;
    }
  }

  const account = resolveFacebookAccount(pageTenant?.agentId);
  const threadId = `fb:${pageId}:${senderPsid}`;

  // Kiểm tra Guardrail 4 Lớp:
  // Nếu tin nhắn CÓ ẢNH: Khách gửi ảnh menu/món/hóa đơn -> KHÔNG lọc guardrail ngoài lề mà chuyển thẳng vào Agent
  if (incomingImages.length === 0) {
    const decision = await applyFacebookGuardrail({
      pageId,
      senderPsid,
      messageText,
    });

    if (decision.action === "MUTED") {
      log.info({ pageId, senderPsid }, "Guardrail: Khách bị cấm chat do spam ngoài lề quá 3 lần - im lặng");
      return;
    }

    if (decision.action === "REPLIED") {
      // Bật chỉ báo đang soạn tin ngắn
      await sendFacebookTyping({ pageAccessToken: effectiveToken, recipientPsid: senderPsid, typing: true });

      // Ghi tin nhắn khách và câu trả lời vào lịch sử
      appendMessage(account.id, threadId, {
        role: "user",
        content: messageText,
      });

      await sendFacebookMessage({
        pageAccessToken: effectiveToken,
        recipientPsid: senderPsid,
        text: decision.replyText,
      });

      appendMessage(account.id, threadId, {
        role: "assistant",
        content: decision.replyText,
      });

      await sendFacebookTyping({ pageAccessToken: effectiveToken, recipientPsid: senderPsid, typing: false });
      return;
    }
  }

  const incomingMessage: ParsedMessage = {
    accountId: account.id,
    threadId,
    threadType: ThreadType.User,
    isGroup: false,
    senderId: senderPsid,
    senderName: `Khách Messenger (${senderPsid.slice(-4)})`,
    text: messageText,
    images: incomingImages,
    msgId: item.message?.mid ?? `fb_${Date.now()}`,
    cliMsgId: item.message?.mid ?? `fb_${Date.now()}`,
    isSelf: false,
    mentionsMe: true,
    sentAt: new Date(item.timestamp || Date.now()).toISOString(),
    rawData: item as unknown as Record<string, unknown>,
  };

  // 2. Tải ảnh về đĩa (media-store) TRƯỚC khi gọi Agent và ghi history
  if (incomingMessage.images.length > 0) {
    await persistBatchImages(account.id, [incomingMessage]);
  }

  const savedImagePaths = imagePathsOf(incomingMessage.images);

  // Ghi tin của khách vào lịch sử hội thoại (kèm mảng đường dẫn ảnh đã tải nếu có)
  appendMessage(account.id, threadId, {
    role: "user",
    content: messageText,
    images: savedImagePaths.length > 0 ? savedImagePaths : undefined,
  });

  // Bật chỉ báo đang soạn tin
  await sendFacebookTyping({ pageAccessToken: effectiveToken, recipientPsid: senderPsid, typing: true });

  const trace: StepTrace[] = [];

  try {
    const result = await runAgentTurn({
      api: null, // Kênh Messenger không dùng zca-js cá nhân
      account,
      batch: [incomingMessage],
      trace,
    });

    const replyText = result.text.trim();
    if (replyText) {
      // Gửi câu trả lời về lại cho khách trên Facebook
      await sendFacebookMessage({
        pageAccessToken: effectiveToken,
        recipientPsid: senderPsid,
        text: replyText,
      });

      // Ghi câu trả lời của bot vào lịch sử
      appendMessage(account.id, threadId, {
        role: "assistant",
        content: replyText,
      });

      // Tăng bộ đếm usage của Page trong chu kỳ
      checkAndIncrementUsage(pageId);
    }
  } catch (err) {
    log.error({ err, senderPsid }, "Lỗi khi xử lý lượt chat Facebook");
    await sendFacebookMessage({
      pageAccessToken: effectiveToken,
      recipientPsid: senderPsid,
      text: "Dạ hiện tại hệ thống phản hồi đang bận một chút, em đã báo lại nhân viên hỗ trợ anh/chị ngay nhé ạ!",
    });
  } finally {
    // Tắt chỉ báo đang soạn tin
    await sendFacebookTyping({ pageAccessToken: effectiveToken, recipientPsid: senderPsid, typing: false });
  }
}
