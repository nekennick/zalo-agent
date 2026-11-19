import { TextStyle, type Mention, type Style } from "zca-js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Xử lý Mention (Tag tên) người dùng khi bot trả lời trong nhóm Zalo.
 *
 * Zalo mention cần:
 * 1. Văn bản chứa cụm `@Tên`.
 * 2. Mảng `mentions: [{ pos, uid, len }]` khớp đúng vị trí và độ dài trong văn bản.
 * 3. Khi gắn prefix `@Tên `, toàn bộ offset `start` của `styles` (in đậm, đổi màu)
 *    phải được tịnh tiến tương ứng để không bị lệch định dạng.
 *
 * Module THUẦN: không env, không logger, không DB.
 */

export type MentionReceiver = {
  uid: string;
  name: string;
};

/**
 * Trích thông tin người cần tag từ tin mở đầu lượt.
 * Chỉ tag trong nhóm (`msg.isGroup`) và không tag chính bot (`msg.isSelf`).
 */
export function trichNguoiNhanMention(msg: ParsedMessage): MentionReceiver | undefined {
  if (!msg.isGroup || msg.isSelf) return undefined;
  if (!msg.senderId || msg.senderId === "0" || msg.senderId === "-1") return undefined;
  const name = (msg.senderName || "").replace(/^@+/, "").trim();
  if (!name) return undefined;
  return { uid: msg.senderId, name };
}

export type KetQuaGanMention = {
  text: string;
  styles: Style[];
  mentions: Mention[];
};

/**
 * Gắn mention của người mở lượt vào câu trả lời:
 * - Nếu câu trả lời đã bắt đầu bằng `@Tên`: giữ nguyên text và styles, chỉ đính mention.
 * - Nếu dòng đầu là Tiêu đề (có style `TextStyle.Big` ở vị trí 0): gắn `@Tên\n` để tiêu đề xuống dòng giữ nguyên định dạng.
 * - Các trường hợp văn bản thường: gắn `@Tên ` ở đầu câu, tịnh tiến toàn bộ offset của `styles`.
 */
export function ganMentionDauCau(p: {
  text: string;
  styles?: Style[];
  member?: MentionReceiver;
}): KetQuaGanMention {
  const { text, styles = [], member } = p;
  if (!member || !member.uid || !member.name.trim()) {
    return { text, styles, mentions: [] };
  }

  const cleanName = member.name.replace(/^@+/, "").trim();
  if (!cleanName) {
    return { text, styles, mentions: [] };
  }

  const tagExact = `@${cleanName}`;

  // 1. Trường hợp text vốn đã bắt đầu bằng @cleanName
  if (text.startsWith(tagExact)) {
    return {
      text,
      styles,
      mentions: [
        {
          pos: 0,
          uid: member.uid,
          len: tagExact.length,
        },
      ],
    };
  }

  // 2. Xác định ký tự phân cách: Nếu dòng đầu là Tiêu đề (`TextStyle.Big` ở vị trí 0),
  // ngắt dòng bằng `\n` để khối tiêu đề bên dưới giữ trọn vẹn màu sắc và cỡ chữ.
  const laTieuDeDauDong = styles.some((s) => s.start === 0 && s.st === TextStyle.Big);
  const separator = laTieuDeDauDong ? "\n" : " ";
  const prefix = `${tagExact}${separator}`;
  const textMoi = `${prefix}${text}`;
  const offset = prefix.length;

  const stylesMoi = styles.map((s) => ({
    ...s,
    start: s.start + offset,
  }));

  return {
    text: textMoi,
    styles: stylesMoi,
    mentions: [
      {
        pos: 0,
        uid: member.uid,
        len: tagExact.length,
      },
    ],
  };
}
