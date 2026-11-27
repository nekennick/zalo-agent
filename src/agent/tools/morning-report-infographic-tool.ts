import { readFile, stat } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { renderMorningReportPng, type MorningReportJson } from "../../images/morning-report-infographic.js";
import { createTempFile } from "../../shared/temp-file-store.js";
import { guiFileKemCaption } from "./send-attachment-with-caption.js";
import { ghiChuDaGuiAnh } from "./sent-by-tool-note.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { apiCaNhan } from "./tool-catalog-types.js";
import type { ToolContext } from "./index.js";

export const DEFAULT_MORNING_REPORT_JSON_PATH =
  "/app/workspace/quan-ly-kim/zlo-ql-kim/group_zlo-ql-kim_6244108299423959453/outputs/morning-report.json";

export interface MorningReportInfographicOptions {
  jsonPath?: string;
}

/**
 * Tool tạo và gửi ảnh Infographic báo cáo đóng hàng sáng theo 1 mẫu cố định duy nhất.
 *
 * - Trong lượt LỊCH HẸN (`ctx.isolated === true`): đẩy file PNG tạm vào
 *   `ctx.queueScheduledAttachment` để Scheduler gửi qua `deliverProactively`
 *   (tuân thủ trần ngày, retry và dọn file tạm đúng chuẩn lịch hẹn).
 * - Trong lượt CHAT THƯỜNG (`!ctx.isolated`): gửi thẳng ảnh kèm caption qua
 *   `guiFileKemCaption` rồi xóa file tạm ngay sau khi gửi.
 */
export function createMorningReportInfographicTool(
  ctx: ToolContext,
  options: MorningReportInfographicOptions = {},
) {
  const targetJsonPath =
    options.jsonPath || process.env.MORNING_REPORT_JSON_PATH || DEFAULT_MORNING_REPORT_JSON_PATH;

  return tool({
    description:
      "Tạo ảnh Infographic báo cáo đóng hàng sáng (chuẩn 1 mẫu cố định duy nhất, số liệu chính xác 100% từ file morning-report.json) và gửi vào nhóm Zalo. " +
      "Dùng khi được yêu cầu gửi báo cáo sáng dạng ảnh / infographic thay cho tin nhắn văn bản dài.",
    inputSchema: z.object({
      caption: z
        .string()
        .optional()
        .describe("Lời nhắn ngắn gửi kèm ảnh (nếu muốn, ví dụ: Báo cáo đóng hàng sáng hôm nay)."),
    }),
    execute: async ({ caption }) => {
      let reportData: MorningReportJson;
      try {
        const fileStat = await stat(targetJsonPath);
        if (!fileStat.isFile()) {
          return ketQuaLoi(`Đường dẫn dữ liệu báo cáo sáng không phải là file: ${targetJsonPath}`);
        }
        const raw = await readFile(targetJsonPath, "utf-8");
        reportData = JSON.parse(raw) as MorningReportJson;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(
          `Không thể đọc dữ liệu báo cáo sáng tại "${targetJsonPath}": ${msg}.`,
        );
      }

      let pngBuffer: Buffer;
      try {
        pngBuffer = renderMorningReportPng(reportData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(`Lỗi khi dựng ảnh Infographic báo cáo sáng: ${msg}`);
      }

      const temp = createTempFile("bao-cao-dong-hang-sang.png", pngBuffer);

      // Lượt Lịch hẹn: bàn giao cho Scheduler gửi qua deliverProactively
      if (ctx.isolated && ctx.queueScheduledAttachment) {
        ctx.queueScheduledAttachment(temp);
        return (
          "Đã dựng xong ảnh Infographic báo cáo đóng hàng sáng chuẩn mẫu cố định và đưa vào hàng đợi gửi của Lịch hẹn. " +
          "Hãy trả lời NGẮN GỌN 1-2 dòng (làm caption gửi kèm ảnh), KHÔNG lặp lại toàn bộ bảng số liệu dạng text."
        );
      }

      // Lượt chat thường: gửi trực tiếp rồi dọn file tạm
      try {
        const api = apiCaNhan(ctx);
        const threadKey = `${ctx.account.id}:${ctx.message.threadId}`;
        await guiFileKemCaption(
          api,
          threadKey,
          ctx.message.threadId,
          ctx.message.threadType,
          temp.filePath,
          caption,
        );
        ctx.ghiNhanDaGui?.(ghiChuDaGuiAnh(1, caption));
        return "Đã tạo và gửi ảnh Infographic báo cáo đóng hàng sáng vào cuộc trò chuyện rồi.";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(`Gửi ảnh Infographic thất bại: ${msg}`);
      } finally {
        temp.cleanup();
      }
    },
  });
}
