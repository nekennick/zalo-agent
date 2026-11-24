import { tool } from "ai";
import { z } from "zod";
import { findVietQrAccountByKeyword } from "../../conversation/vietqr-bank-store.js";

/**
 * Tool tra cứu thông tin tài khoản ngân hàng của người thanh toán đơn (ví dụ chị Dung, anh Khoa).
 */
export function createLookupReceiverTool() {
  return tool({
    description:
      "Tra cứu xem người thanh toán đơn (ví dụ: 'chị Dung', 'anh Khoa') đã có thông tin tài khoản ngân hàng trong hệ thống chưa trước khi chốt bill.",
    inputSchema: z.object({
      receiver_name: z
        .string()
        .min(1)
        .describe("Tên hoặc biệt danh của người nhận chuyển khoản thanh toán (ví dụ: 'chị Dung', 'Khoa', 'Phan Thanh Dung')"),
    }),
    execute: async ({ receiver_name }) => {
      const acc = findVietQrAccountByKeyword(receiver_name);
      if (acc) {
        return {
          found: true,
          account: {
            bankName: acc.bankName,
            bankCode: acc.bankCode,
            accountNumber: acc.accountNumber,
            accountHolder: acc.accountHolder,
            nickname: acc.nickname,
          },
          instruction: `Đã có tài khoản của ${acc.accountHolder} (${acc.bankName} - ${acc.accountNumber}). Bạn hãy dùng thông tin này để tổng kết bill và thông báo cho cả nhóm.`,
        };
      }

      return {
        found: false,
        receiverName: receiver_name,
        message: `Chưa có thông tin số tài khoản của "${receiver_name}" trong hệ thống. Nhờ anh Khoa vào Dashboard Web (mục Tài khoản VietQR) để thêm STK trước.`,
      };
    },
  });
}
