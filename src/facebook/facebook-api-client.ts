import { createLogger } from "../shared/logger.js";

const log = createLogger("facebook-api");
const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const FB_MAX_CHARS = 2000;

export type SendFbMessageResult = {
  recipient_id: string;
  message_id: string;
};

/**
 * Gửi tin nhắn text hoặc gửi hành động (typing indicator) tới khách hàng qua Meta Graph API.
 */
export async function sendFacebookMessage(params: {
  pageAccessToken: string;
  recipientPsid: string;
  text: string;
}): Promise<void> {
  const { pageAccessToken, recipientPsid, text } = params;
  if (!text.trim()) return;

  // Cắt tin nếu dài hơn trần 2000 ký tự của Facebook
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= FB_MAX_CHARS) {
      parts.push(remaining);
      break;
    }
    // Cắt theo ranh giới xuống dòng hoặc khoảng trắng
    let cutIdx = remaining.lastIndexOf("\n", FB_MAX_CHARS);
    if (cutIdx <= 0) cutIdx = remaining.lastIndexOf(" ", FB_MAX_CHARS);
    if (cutIdx <= 0) cutIdx = FB_MAX_CHARS;
    parts.push(remaining.slice(0, cutIdx).trim());
    remaining = remaining.slice(cutIdx).trim();
  }

  for (const part of parts) {
    await sendOneFacebookText(pageAccessToken, recipientPsid, part);
  }
}

async function sendOneFacebookText(
  pageAccessToken: string,
  recipientPsid: string,
  messageText: string,
): Promise<void> {
  const url = `${GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const body = {
    recipient: { id: recipientPsid },
    messaging_type: "RESPONSE",
    message: { text: messageText },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.error({ status: res.status, recipientPsid, errBody }, "Lỗi khi gọi Facebook Graph API gửi tin");
      return;
    }

    log.debug({ recipientPsid }, "Đã gửi tin nhắn Facebook thành công");
  } catch (err) {
    log.error({ err, recipientPsid }, "Lỗi mạng khi gửi tin tới Facebook Graph API");
  }
}

/**
 * Bật/tắt chỉ báo "đang soạn tin" (typing_on / typing_off) trên Messenger.
 */
export async function sendFacebookTyping(params: {
  pageAccessToken: string;
  recipientPsid: string;
  typing: boolean;
}): Promise<void> {
  const { pageAccessToken, recipientPsid, typing } = params;
  const url = `${GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const body = {
    recipient: { id: recipientPsid },
    sender_action: typing ? "typing_on" : "typing_off",
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.debug({ err }, "Lỗi khi gửi chỉ báo typing tới Facebook");
  }
}
