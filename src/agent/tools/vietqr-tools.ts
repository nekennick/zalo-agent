import { tool } from "ai";
import { z } from "zod";
import {
  findVietQrAccountByKeyword,
  getDefaultVietQrAccount,
} from "../../conversation/vietqr-bank-store.js";
import { createLogger } from "../../shared/logger.js";
import { taiBufferVietQr } from "../../shared/vietqr-generator.js";
import { withNamedTempFile } from "../../shared/temp-file-store.js";
import type { ToolContext } from "./index.js";
import { guiFileKemCaption } from "./send-attachment-with-caption.js";
import { ghiChuDaGuiAnh } from "./sent-by-tool-note.js";
import { ketQuaLoi } from "./tool-failure-result.js";

const log = createLogger("vietqr-tools");

/**
 * Tool tạo và gửi ảnh mã VietQR (chuẩn Napas 247) trực tiếp vào nhóm chat Zalo.
 */
export function createSendPaymentQrTool(ctx: ToolContext) {
  const api = ctx.api;
  return tool({
    description:
      "Tạo và gửi mã QR VietQR (chuẩn Napas 247) trực tiếp vào cuộc trò chuyện Zalo để thành viên quét chuyển khoản đúng số tiền món ăn/đồ uống.",
    inputSchema: z.object({
      receiver_name: z
        .string()
        .optional()
        .describe("Tên người nhận thanh toán đã chốt ở bill (ví dụ: 'chị Dung'). Nếu bỏ trống sẽ dùng tài khoản mặc định."),
      amount: z.coerce.number().positive().describe("Số tiền cần chuyển khoản (VNĐ, ví dụ: 45000)"),
      memo: z
        .string()
        .min(1)
        .describe("Nội dung chuyển tiền ngắn gọn không dấu (ví dụ: 'Khoa tra tien bun bo')"),
      caption: z
        .string()
        .optional()
        .describe(
          "Ghi chú ngắn gọn kèm ảnh QR đúng mẫu: 'Dạ em gửi mã QR [tên món] của [xưng hô + tên khách].' " +
          "(ví dụ: 'Dạ em gửi mã QR ly Trà Olong nho mẫu đơn của anh Khoa.' hoặc 'Dạ em gửi mã QR đơn món của anh Khoa.'). " +
          "KHÔNG ghi thêm người nhận hay ngân hàng.",
        ),
    }),
    execute: async ({ receiver_name, amount, memo, caption }) => {
      if (!api) {
        return ketQuaLoi("Không có quyền gửi ảnh trong kênh bot này.");
      }

      const trimmedReceiver = receiver_name?.trim();
      let acc: ReturnType<typeof getDefaultVietQrAccount> = null;

      if (trimmedReceiver) {
        acc = findVietQrAccountByKeyword(trimmedReceiver);
        if (!acc) {
          log.warn({ receiver_name: trimmedReceiver }, "Không tìm thấy tài khoản ngân hàng của người nhận được yêu cầu");
          return ketQuaLoi(
            `Không tìm thấy tài khoản ngân hàng của người nhận "${trimmedReceiver}". Tuyệt đối KHÔNG tự ý lấy tài khoản người khác để gửi thay thế. Vui lòng kiểm tra lại tên người nhận hoặc nhờ người nhận cung cấp STK.`,
          );
        }
      } else {
        acc = getDefaultVietQrAccount();
      }

      if (!acc) {
        return ketQuaLoi(
          "Chưa tìm thấy tài khoản ngân hàng để nhận thanh toán. Nhờ anh Khoa cấu hình STK trên Dashboard Web trước.",
        );
      }

      const buf = await taiBufferVietQr({
        bankCode: acc.bankCode,
        accountNumber: acc.accountNumber,
        amount,
        memo,
        accountHolder: acc.accountHolder,
      });

      if (!buf) {
        return ketQuaLoi("Không thể tạo mã VietQR từ máy chủ VietQR. Vui lòng thử lại sau.");
      }

      const threadKey = `${ctx.account.id}:${ctx.message.threadId}`;
      const defaultCaption = caption || `Dạ em gửi mã QR đơn món của ${ctx.message.senderName}.`;
      const fileName = `vietqr-${Date.now()}.png`;

      try {
        await withNamedTempFile(fileName, buf, async (filePath) => {
          await guiFileKemCaption(
            api,
            threadKey,
            ctx.message.threadId,
            ctx.message.threadType,
            filePath,
            defaultCaption,
          );
        });

        ctx.ghiNhanDaGui?.(ghiChuDaGuiAnh(1, defaultCaption));
        return (
          "Đã tạo và gửi ảnh mã QR kèm ghi chú vào nhóm thành công rồi. " +
          "Tin nhắn trả lời bên dưới CHỈ báo thông tin món theo đúng mẫu ngắn gọn sau, " +
          "KHÔNG tự thuật bước làm (như 'Đã gửi xong mã QR...'), KHÔNG nhắc lại người nhận/ngân hàng hay thêm câu chào dài dòng:\n" +
          "Dạ món của anh/chị là:\n" +
          "- Món: [số lượng + tên món]\n" +
          "- Số tiền: [số tiền]đ\n" +
          "(Nếu nhiều món thì liệt kê mỗi món 1 dòng '- [số lượng] [tên món]: [tiền]đ' rồi chốt '- Tổng cộng: [tổng]đ')"
        );
      } catch (err) {
        log.error({ err, threadKey }, "Lỗi khi gửi ảnh VietQR vào Zalo");
        return ketQuaLoi("Gửi ảnh mã QR vào nhóm thất bại do lỗi đường truyền Zalo.");
      }
    },
  });
}
