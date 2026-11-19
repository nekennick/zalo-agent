import test from "node:test";
import assert from "node:assert/strict";
import { TextStyle, ThreadType, type Style } from "zca-js";
import { ganMentionDauCau, trichNguoiNhanMention } from "./reply-mention.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

function taoTinMau(override: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc1",
    threadId: "thread1",
    threadType: ThreadType.Group,
    isGroup: true,
    senderId: "user123",
    senderName: "Khoa Tran",
    text: "Chào bot",
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: true,
    sentAt: new Date().toISOString(),
    rawData: {},
    ...override,
  };
}

test("trichNguoiNhanMention: trả về uid và name khi tin từ nhóm và người khác gửi", () => {
  const tin = taoTinMau();
  const receiver = trichNguoiNhanMention(tin);
  assert.deepEqual(receiver, { uid: "user123", name: "Khoa Tran" });
});

test("trichNguoiNhanMention: bỏ qua khi không phải nhóm hoặc bot tự gửi", () => {
  assert.equal(trichNguoiNhanMention(taoTinMau({ isGroup: false })), undefined);
  assert.equal(trichNguoiNhanMention(taoTinMau({ isSelf: true })), undefined);
  assert.equal(trichNguoiNhanMention(taoTinMau({ senderId: "" })), undefined);
  assert.equal(trichNguoiNhanMention(taoTinMau({ senderId: "0" })), undefined);
  assert.equal(trichNguoiNhanMention(taoTinMau({ senderName: "   " })), undefined);
});

test("trichNguoiNhanMention: gỡ bỏ dấu @ dư thừa ở đầu tên nếu có", () => {
  const tin = taoTinMau({ senderName: "@Admin" });
  assert.deepEqual(trichNguoiNhanMention(tin), { uid: "user123", name: "Admin" });
});

test("ganMentionDauCau: không thay đổi gì khi không có thông tin member", () => {
  const kq = ganMentionDauCau({ text: "Xin chào", styles: [] });
  assert.equal(kq.text, "Xin chào");
  assert.deepEqual(kq.mentions, []);
});

test("ganMentionDauCau: thêm @Tên vào đầu câu văn xuôi và tịnh tiến styles", () => {
  const styles: Style[] = [
    { start: 4, len: 4, st: TextStyle.Bold }, // Chữ "chào" trong "Xin chào"
  ];
  const kq = ganMentionDauCau({
    text: "Xin chào bạn",
    styles,
    member: { uid: "u1", name: "Khoa" },
  });

  // Prefix là "@Khoa " (độ dài 6 ký tự)
  assert.equal(kq.text, "@Khoa Xin chào bạn");
  assert.deepEqual(kq.mentions, [
    { pos: 0, uid: "u1", len: 5 }, // "@Khoa" dài 5 ký tự
  ]);
  // Style ban đầu ở vị trí 4 -> dịch thành 4 + 6 = 10
  assert.deepEqual(kq.styles, [
    { start: 10, len: 4, st: TextStyle.Bold },
  ]);
});

test("ganMentionDauCau: ngắt dòng bằng \\n khi dòng đầu là Tiêu đề (TextStyle.Big)", () => {
  const styles: Style[] = [
    { start: 0, len: 7, st: TextStyle.Big },
    { start: 0, len: 7, st: TextStyle.Bold },
    { start: 0, len: 7, st: TextStyle.Green },
  ];
  const kq = ganMentionDauCau({
    text: "Tiêu đề\nNội dung chi tiết",
    styles,
    member: { uid: "u1", name: "Khoa" },
  });

  // Prefix là "@Khoa\n" (độ dài 6 ký tự)
  assert.equal(kq.text, "@Khoa\nTiêu đề\nNội dung chi tiết");
  assert.deepEqual(kq.mentions, [
    { pos: 0, uid: "u1", len: 5 },
  ]);
  // Styles của tiêu đề dịch sang 0 + 6 = 6
  assert.deepEqual(kq.styles, [
    { start: 6, len: 7, st: TextStyle.Big },
    { start: 6, len: 7, st: TextStyle.Bold },
    { start: 6, len: 7, st: TextStyle.Green },
  ]);
});

test("ganMentionDauCau: không nhân đôi nếu text vốn đã có @Tên ở đầu", () => {
  const styles: Style[] = [{ start: 6, len: 4, st: TextStyle.Bold }];
  const kq = ganMentionDauCau({
    text: "@Khoa Dạ em gửi lại anh",
    styles,
    member: { uid: "u1", name: "Khoa" },
  });

  assert.equal(kq.text, "@Khoa Dạ em gửi lại anh");
  assert.deepEqual(kq.mentions, [
    { pos: 0, uid: "u1", len: 5 },
  ]);
  // Không đổi styles vì không chèn thêm text
  assert.deepEqual(kq.styles, styles);
});
