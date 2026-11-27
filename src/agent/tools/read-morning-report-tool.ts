import { tool } from "ai";
import { stat, readFile } from "node:fs/promises";
import { z } from "zod";
import { ketQuaLoi } from "./tool-failure-result.js";

export const DEFAULT_MORNING_REPORT_PATH =
  "/app/workspace/quan-ly-kim/zlo-ql-kim/group_zlo-ql-kim_6244108299423959453/outputs/morning-report.txt";

export interface ReadMorningReportOptions {
  filePath?: string;
}

/**
 * Đọc file báo cáo đóng hàng sáng do Agent Quản lý Kim tổng hợp mỗi 07:00 sáng.
 * Cung cấp thông tin chi tiết:
 * - Số chi nhánh theo lịch hôm nay
 * - Chi nhánh đã đặt hàng, số phiếu và giá trị
 * - Danh sách chi nhánh chưa đặt hàng cần nhắc nhở
 * - Đơn gửi xe ngoài và đơn ngoài lịch khác
 * - Số lượng 4 mã siết tồn (SML, SMN, SLTL, MYG) cần đóng của Tổng kho và Kho Bình Dương
 */
export function createReadMorningReportTool(options: ReadMorningReportOptions = {}) {
  const targetPath = options.filePath || process.env.MORNING_REPORT_PATH || DEFAULT_MORNING_REPORT_PATH;

  return tool({
    description:
      "Đọc báo cáo đóng hàng sáng mới nhất từ hệ thống (do Quản lý Kim tổng hợp từ KiotViet lúc 07:00 sáng). " +
      "Trả về toàn bộ số liệu: chi nhánh theo lịch, chi nhánh đã đặt, chi nhánh chưa đặt, đơn gửi xe ngoài, " +
      "và số lượng cần/tồn/giữ/khả dụng của 4 mã siết tồn (SML, SMN, SLTL, MYG) của Tổng kho và Kho Bình Dương. " +
      "Dùng khi cần tổng hợp hoặc gửi báo cáo đóng hàng sáng, kiểm tra tiến độ đặt hàng của các chi nhánh hoặc 4 mã siết tồn hôm nay.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const fileStat = await stat(targetPath);
        if (!fileStat.isFile()) {
          return ketQuaLoi(`Đường dẫn báo cáo sáng không phải là file: ${targetPath}`);
        }

        const content = await readFile(targetPath, "utf-8");
        const trimmed = content.trim();
        if (!trimmed) {
          return ketQuaLoi("File báo cáo đóng hàng sáng hiện đang rỗng.");
        }

        const updatedAt = fileStat.mtime.toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          hour12: false,
        });

        return [
          `=== DỮ LIỆU BÁO CÁO ĐÓNG HÀNG SÁNG (Ghi nhận lúc: ${updatedAt}) ===`,
          `Nguồn file: ${targetPath}`,
          "",
          trimmed,
        ].join("\n");
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(
          `Không thể đọc file báo cáo đóng hàng sáng tại "${targetPath}": ${errorMsg}. ` +
          "Có thể file chưa được tạo hoặc volume dữ liệu chưa được kết nối.",
        );
      }
    },
  });
}
