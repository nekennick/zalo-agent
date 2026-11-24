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
        .describe("Lời nhắn kèm ảnh QR cực kỳ ngắn gọn, súc tích (ví dụ: 'Mã QR phần anh Kiệt ạ')"),
    }),
    execute: async ({ receiver_name, amount, memo, caption }) => {
      if (!api) {
        return ketQuaLoi("Không có quyền gửi ảnh trong kênh bot này.");
      }

      const acc =
        (receiver_name ? findVietQrAccountByKeyword(receiver_name) : null) ??
        getDefaultVietQrAccount();

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
      const defaultCaption = caption || `@${ctx.message.senderName} Mã QR chuyển tiền ${amount.toLocaleString("vi-VN")}đ cho ${acc.accountHolder} (${acc.bankName}) ạ.`;
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
        return "Đã tạo và GỬI mã QR thanh toán thành công cho người dùng vào nhóm.";
      } catch (err) {
        log.error({ err, threadKey }, "Lỗi khi gửi ảnh VietQR vào Zalo");
        return ketQuaLoi("Gửi ảnh mã QR vào nhóm thất bại do lỗi đường truyền Zalo.");
      }
    },
  });
}
