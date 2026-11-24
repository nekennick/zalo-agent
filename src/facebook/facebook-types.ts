/**
 * Cấu trúc dữ liệu Webhook và Graph API của Meta Messenger.
 * Tham khảo: https://developers.facebook.com/docs/messenger-platform/reference/webhook-events
 */

export type FacebookSender = {
  id: string; // PSID (Page-Scoped ID) của người gửi
};

export type FacebookRecipient = {
  id: string; // Page ID nhận tin
};

export type FacebookAttachment = {
  type: "image" | "video" | "audio" | "file" | "fallback";
  payload: {
    url?: string;
    title?: string;
  };
};

export type FacebookMessageEvent = {
  mid: string;
  text?: string;
  attachments?: FacebookAttachment[];
  is_echo?: boolean; // True khi nhân viên trả lời từ Meta Business Suite
  app_id?: number;
};

export type FacebookMessagingItem = {
  sender: FacebookSender;
  recipient: FacebookRecipient;
  timestamp: number;
  message?: FacebookMessageEvent;
  postback?: {
    title: string;
    payload: string;
  };
};

export type FacebookEntry = {
  id: string; // Page ID
  time: number;
  messaging?: FacebookMessagingItem[];
};

export type FacebookWebhookPayload = {
  object: "page" | string;
  entry?: FacebookEntry[];
};
