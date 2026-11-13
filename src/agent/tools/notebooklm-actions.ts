import {
  docVaChuanHoaFileNotebookLm,
  type chayFfmpegSangMp3,
} from "../../notebooklm/audio-converter.js";
import {
  addSourceToNblm,
  askQuestionInNblm,
  createNotebookInNblm,
  downloadContentFromNblm,
  generateContentInNblm,
  listContentInNblm,
  type NotebookLmClientOptions,
} from "../../notebooklm/notebooklm-client.js";
import {
  getThreadNotebook,
  saveThreadNotebook,
  type ThreadNotebook,
} from "../../notebooklm/notebooklm-store.js";
import { withNamedTempFile } from "../../shared/temp-file-store.js";
import type { ToolContext } from "./index.js";
import type { NotebookLmInput } from "./notebooklm-tool-schema.js";
import { guiFileKemCaption } from "./send-attachment-with-caption.js";
import { ghiChuDaGuiFile } from "./sent-by-tool-note.js";
import { ketQuaLoi, type KetQuaLoiTool } from "./tool-failure-result.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";

export type NotebookLmActionDeps = NotebookLmClientOptions & {
  ffmpegRunner?: typeof chayFfmpegSangMp3;
};

const DELIVERED_NOTE =
  "Đã tạo và GỬI file sản phẩm NotebookLM cho người dùng rồi. KHÔNG gọi send_file để gửi lại file này.";
const CHUA_CO_SO_TAY_MSG =
  "Chưa có sổ tay NotebookLM cho cuộc trò chuyện này. Hãy gọi action='add_source' nạp tài liệu trước.";

async function ensureThreadNotebook(
  ctx: Pick<ToolContext, "account" | "message">,
  deps?: NotebookLmActionDeps,
): Promise<ThreadNotebook> {
  const existing = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (existing) return existing;
  const title = `Zalo - ${ctx.account.id} - ${ctx.message.threadId}`;
  const created = await createNotebookInNblm(title, deps);
  return saveThreadNotebook({
    accountId: ctx.account.id,
    threadId: ctx.message.threadId,
    notebookId: created.notebookId,
    notebookUrl: created.notebookUrl,
    title: created.title,
  });
}

export async function doAddSource(
  ctx: ToolContext,
  input: Extract<NotebookLmInput, { action: "add_source" }>,
  deps?: NotebookLmActionDeps,
): Promise<string | KetQuaLoiTool> {
  if ((input.sourceType === "url" || input.sourceType === "youtube") && !input.url) {
    return ketQuaLoi("action='add_source' với sourceType='url'/'youtube' bắt buộc phải có tham số url.");
  }
  if (input.sourceType === "text" && !input.text?.trim()) {
    return ketQuaLoi("action='add_source' với sourceType='text' bắt buộc phải có tham số text.");
  }
  const nb = await ensureThreadNotebook(ctx, deps);
  const res = await addSourceToNblm(
    { notebookUrl: nb.notebookUrl, sourceType: input.sourceType, url: input.url, text: input.text, title: input.title },
    deps,
  );
  return `Đã nạp nguồn (${input.sourceType}) "${res.title || "Tài liệu mới"}" vào sổ tay NotebookLM của cuộc trò chuyện này (${nb.title}).`;
}

export async function doListSources(ctx: ToolContext, deps?: NotebookLmActionDeps): Promise<string> {
  const nb = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (!nb) {
    return "Cuộc trò chuyện này chưa có sổ tay NotebookLM nào. Hãy gọi action='add_source' để nạp tài liệu đầu tiên.";
  }
  const overview = await listContentInNblm(nb.notebookUrl, deps);
  const srcLines =
    overview.sources.length > 0
      ? overview.sources.map((s, idx) => `${idx + 1}. ${s.name} (${s.type}, ${s.status})`).join("\n")
      : "(Chưa có nguồn tài liệu nào)";
  const genLines =
    overview.generatedContent.length > 0
      ? overview.generatedContent.map((g) => `- ${g.type}: ${g.title} (${g.status})`).join("\n")
      : "(Chưa có sản phẩm Studio nào)";
  return wrapUntrustedContent(
    `Sổ tay: ${nb.title}\nTổng số nguồn: ${overview.sourceCount}\nDanh sách nguồn:\n${srcLines}\nSản phẩm Studio:\n${genLines}`,
    "danh sách nguồn NotebookLM",
  );
}

export async function doAsk(
  ctx: ToolContext,
  input: Extract<NotebookLmInput, { action: "ask" }>,
  deps?: NotebookLmActionDeps,
): Promise<string | KetQuaLoiTool> {
  const nb = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (!nb) return ketQuaLoi(CHUA_CO_SO_TAY_MSG);
  const res = await askQuestionInNblm(nb.notebookUrl, input.question, deps);
  const citeBlock =
    res.citations.length > 0
      ? "\n\nTrích dẫn nguồn:\n" +
        res.citations.map((c) => `${c.marker} ${c.sourceName ? `[${c.sourceName}] ` : ""}${c.sourceText}`.trim()).join("\n")
      : "";
  return wrapUntrustedContent(`${res.answer}${citeBlock}`, "câu trả lời từ NotebookLM");
}

export async function doGenerateReport(
  ctx: ToolContext,
  input: Extract<NotebookLmInput, { action: "generate_report" }>,
  deps?: NotebookLmActionDeps,
): Promise<string | KetQuaLoiTool> {
  const nb = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (!nb) return ketQuaLoi(CHUA_CO_SO_TAY_MSG);
  const res = await generateContentInNblm(
    { notebookUrl: nb.notebookUrl, contentType: "report", language: input.language ?? "vi", reportFormat: input.reportFormat },
    deps,
  );
  if (!res.textContent) {
    return ketQuaLoi("NotebookLM không trả về nội dung báo cáo. Hãy kiểm tra xem sổ tay đã có nguồn tài liệu chưa.");
  }
  return wrapUntrustedContent(res.textContent, "báo cáo NotebookLM");
}

export async function doGenerateSlides(
  ctx: ToolContext,
  input: Extract<NotebookLmInput, { action: "generate_slides" }>,
  deps?: NotebookLmActionDeps,
): Promise<string | KetQuaLoiTool> {
  const nb = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (!nb) return ketQuaLoi(CHUA_CO_SO_TAY_MSG);
  await generateContentInNblm(
    {
      notebookUrl: nb.notebookUrl,
      contentType: "presentation",
      customInstructions: input.instructions,
      language: input.language ?? "vi",
      presentationStyle: input.presentationStyle,
      presentationLength: input.presentationLength,
    },
    deps,
  );
  const dl = await downloadContentFromNblm(nb.notebookUrl, "presentation", deps);
  return dl.googleSlidesUrl
    ? `Đã tạo bản trình bày Slide trên Google Slides: ${dl.googleSlidesUrl}`
    : "Đã tạo bản trình bày Slide trong sổ tay NotebookLM thành công.";
}

export async function doGenerateMedia(
  ctx: ToolContext,
  input: Extract<NotebookLmInput, { action: "generate_audio" | "generate_video" | "generate_infographic" }>,
  deps?: NotebookLmActionDeps,
): Promise<string | KetQuaLoiTool> {
  if (!ctx.api) {
    return ketQuaLoi(
      "Zalo Bot API không hỗ trợ gửi file âm thanh/video/ảnh trực tiếp - tính năng xuất file media của NotebookLM chỉ dùng được trên tài khoản cá nhân.",
    );
  }
  const nb = getThreadNotebook(ctx.account.id, ctx.message.threadId);
  if (!nb) return ketQuaLoi(CHUA_CO_SO_TAY_MSG);
  const contentType =
    input.action === "generate_audio" ? "audio_overview" : input.action === "generate_video" ? "video" : "infographic";
  const loai = input.action === "generate_audio" ? "audio" : input.action === "generate_video" ? "video" : "infographic";

  // Thử tải nếu sản phẩm đã được sinh sẵn trong sổ tay (như khi vừa tạo xong hoặc lần trước timeout)
  let dl = await downloadContentFromNblm(nb.notebookUrl, contentType, deps).catch(() => null);

  if (!dl?.filePath) {
    await generateContentInNblm(
      {
        notebookUrl: nb.notebookUrl,
        contentType,
        customInstructions: input.instructions,
        language: input.language ?? "vi",
        videoStyle: input.action === "generate_video" ? input.videoStyle : undefined,
        videoFormat: input.action === "generate_video" ? input.videoFormat : undefined,
        infographicFormat: input.action === "generate_infographic" ? input.infographicFormat : undefined,
      },
      deps,
    );
    dl = await downloadContentFromNblm(nb.notebookUrl, contentType, deps);
  }

  if (!dl?.filePath) {
    return ketQuaLoi(`NotebookLM đã tạo ${contentType} nhưng không trả về đường dẫn file tải về.`);
  }

  const { buffer, ext } = await docVaChuanHoaFileNotebookLm(dl.filePath, loai, deps?.ffmpegRunner);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "") || "bin";
  const fileName = `notebooklm-${loai}-${Date.now()}.${safeExt}`;
  const threadKey = `${ctx.account.id}:${ctx.message.threadId}`;
  await withNamedTempFile(fileName, buffer, (filePath) =>
    guiFileKemCaption(ctx.api!, threadKey, ctx.message.threadId, ctx.message.threadType, filePath, input.caption),
  );
  ctx.ghiNhanDaGui?.(ghiChuDaGuiFile(fileName, input.caption));
  return `${DELIVERED_NOTE} (tên file: ${fileName}, ${Math.round(buffer.length / 1024)} KB)`;
}
