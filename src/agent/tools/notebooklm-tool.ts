import { tool } from "ai";
import type { z } from "zod";
import {
  hoanSuatNotebookLm,
  kiemQuyenVaGiuSuatNotebookLm,
} from "../../notebooklm/notebooklm-guard.js";
import { createLogger } from "../../shared/logger.js";
import type { ToolContext } from "./index.js";
import {
  doAddSource,
  doAsk,
  doGenerateMedia,
  doGenerateReport,
  doGenerateSlides,
  doListSources,
  type NotebookLmActionDeps,
} from "./notebooklm-actions.js";
import { NOTEBOOKLM_TOOL_DESCRIPTION } from "./notebooklm-tool-description.js";
import {
  notebookLmInputSchema,
  notebookLmWireSchema,
  type NotebookLmWireInput,
} from "./notebooklm-tool-schema.js";
import { ketQuaLoi, laKetQuaLoi } from "./tool-failure-result.js";

const log = createLogger("notebooklm-tool");

const YEU_CAU_THEO_ACTION: Record<NotebookLmWireInput["action"], string> = {
  add_source:
    "action='add_source' cần sourceType ('url' | 'youtube' | 'text'), kèm url (nếu là url/youtube) hoặc text (nếu là text).",
  list_sources: "action='list_sources' không cần thêm tham số nào.",
  ask: "action='ask' cần tham số question (câu hỏi cần tra cứu).",
  generate_audio: "action='generate_audio' nhận tùy chọn instructions, language, caption.",
  generate_video: "action='generate_video' nhận tùy chọn instructions, language, videoStyle, videoFormat, caption.",
  generate_infographic:
    "action='generate_infographic' nhận tùy chọn instructions, language, infographicFormat, caption.",
  generate_slides:
    "action='generate_slides' nhận tùy chọn instructions, language, presentationStyle, presentationLength.",
  generate_report: "action='generate_report' nhận tùy chọn language, reportFormat ('summary' | 'detailed').",
};

function cauThieuThamSo(action: NotebookLmWireInput["action"], loi: z.ZodError): string {
  const truong = [...new Set(loi.issues.map((i) => i.path.join(".")).filter(Boolean))];
  const ke =
    truong.length > 0 ? `Thiếu hoặc sai tham số: ${truong.join(", ")}. ` : "Tham số không hợp lệ. ";
  return `${ke}${YEU_CAU_THEO_ACTION[action]} Gọi lại tool với đủ tham số, đừng báo với người dùng là đã xong.`;
}

export function createNotebookLmTool(ctx: ToolContext, deps?: NotebookLmActionDeps) {
  return tool({
    description: NOTEBOOKLM_TOOL_DESCRIPTION,
    inputSchema: notebookLmWireSchema,
    execute: async (wire) => {
      const daThuHep = notebookLmInputSchema.safeParse(wire);
      if (!daThuHep.success) {
        log.warn({ action: wire.action, issues: daThuHep.error.issues }, "notebooklm thiếu tham số");
        return ketQuaLoi(cauThieuThamSo(wire.action, daThuHep.error));
      }
      const input = daThuHep.data;

      const guard = kiemQuyenVaGiuSuatNotebookLm(ctx.account, ctx.message);
      if (!guard.ok) {
        return ketQuaLoi(guard.reason);
      }

      try {
        let kq: Awaited<ReturnType<typeof doAddSource>>;
        switch (input.action) {
          case "add_source":
            kq = await doAddSource(ctx, input, deps);
            break;
          case "list_sources":
            kq = await doListSources(ctx, deps);
            break;
          case "ask":
            kq = await doAsk(ctx, input, deps);
            break;
          case "generate_report":
            kq = await doGenerateReport(ctx, input, deps);
            break;
          case "generate_slides":
            kq = await doGenerateSlides(ctx, input, deps);
            break;
          case "generate_audio":
          case "generate_video":
          case "generate_infographic":
            kq = await doGenerateMedia(ctx, input, deps);
            break;
        }
        if (laKetQuaLoi(kq)) {
          hoanSuatNotebookLm(ctx.account.id, ctx.message.threadId, guard.dayKey);
        }
        return kq;
      } catch (err) {
        hoanSuatNotebookLm(ctx.account.id, ctx.message.threadId, guard.dayKey);
        const reason = err instanceof Error ? err.message : String(err);
        log.error({ err, action: wire.action }, "Tool notebooklm lỗi");
        return ketQuaLoi(
          `Thao tác NotebookLM thất bại (${reason}). Nói thật với người dùng, đừng coi như đã làm xong.`,
        );
      }
    },
  });
}
