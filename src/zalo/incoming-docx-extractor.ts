import { extractDocxText } from "../knowledge/extract-docx-text.js";
import { setMessageContent } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { downloadFromPublicUrl } from "../shared/safe-remote-download.js";
import { laHostCdnZalo } from "./attachment-safety.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

const log = createLogger("docx-extractor");

/** Trần dung lượng tải file docx: 10 MB */
export const MAX_DOCX_BYTES = 10 * 1024 * 1024;

/** Trần ký tự trích xuất đưa vào ngữ cảnh LLM: 30.000 ký tự (~6.000 token) */
export const MAX_DOCX_CHARS = 30_000;

/** Timeout tải file từ CDN Zalo: 15 giây */
export const DOCX_DOWNLOAD_TIMEOUT_MS = 15_000;

/** Kiểm tra tin nhắn Zalo có đính kèm file Word .docx hợp lệ không */
export function laFileDocx(msg: ParsedMessage): boolean {
  if (!msg.dinhKem?.url || !msg.dinhKem?.ten) return false;
  const ten = msg.dinhKem.ten.toLowerCase();
  return ten.endsWith(".docx");
}

/**
 * Tải file .docx từ URL Zalo CDN và trích xuất toàn bộ văn bản (tiêu đề, đoạn, bảng).
 * Đảm bảo an toàn: kiểm tra host CDN, magic bytes PK, và giới hạn ký tự.
 */
export async function trichXuatDocxTuUrl(
  url: string,
  tenFile: string,
  taiFile: typeof downloadFromPublicUrl = downloadFromPublicUrl,
): Promise<string> {
  try {
    if (!laHostCdnZalo(url)) {
      log.warn({ url, tenFile }, "Từ chối tải file docx: Host không thuộc CDN Zalo");
      return `[Tệp Word đính kèm: ${tenFile} - Không thể tải: URL không thuộc CDN Zalo hợp lệ]`;
    }

    const file = await taiFile(url, {
      maxBytes: MAX_DOCX_BYTES,
      timeoutMs: DOCX_DOWNLOAD_TIMEOUT_MS,
      signal: AbortSignal.timeout(DOCX_DOWNLOAD_TIMEOUT_MS),
    });

    if (file.data.length < 4 || file.data.subarray(0, 2).toString("latin1") !== "PK") {
      log.warn({ tenFile }, "File docx không đúng chữ ký zip/PK");
      return `[Tệp Word đính kèm: ${tenFile} - Định dạng file không hợp lệ (không phải OOXML)]`;
    }

    const text = await extractDocxText(file.data);
    const textTrim = text.trim();
    if (!textTrim) {
      return `[Tệp Word đính kèm: ${tenFile} - File rỗng hoặc không chứa văn bản]`;
    }

    const textCat =
      textTrim.length > MAX_DOCX_CHARS
        ? `${textTrim.slice(0, MAX_DOCX_CHARS)}\n\n... [Nội dung file Word ${tenFile} còn tiếp, đã cắt ngắn ở 30.000 ký tự đầu]`
        : textTrim;

    return `[Tệp Word đính kèm: ${tenFile}]\n--- BẮT ĐẦU NỘI DUNG FILE WORD ---\n${textCat}\n--- HẾT NỘI DUNG FILE WORD ---`;
  } catch (err) {
    log.error({ tenFile, err }, "Lỗi khi tải hoặc trích xuất file docx");
    const msgErr = err instanceof Error ? err.message : String(err);
    return `[Tệp Word đính kèm: ${tenFile} - Lỗi đọc nội dung: ${msgErr}]`;
  }
}

/** Nạp nội dung file docx vào batch hiện tại trước khi gọi LLM */
export async function napNoiDungDocxChoBatch(
  batch: ParsedMessage[],
  taiFile: typeof downloadFromPublicUrl = downloadFromPublicUrl,
): Promise<void> {
  for (const msg of batch) {
    // 1. File đính kèm trực tiếp trong tin nhắn
    if (laFileDocx(msg) && msg.dinhKem) {
      const noiDung = await trichXuatDocxTuUrl(msg.dinhKem.url, msg.dinhKem.ten, taiFile);
      const chuGoc = msg.text.trim();
      msg.text = chuGoc && chuGoc !== msg.dinhKem.ten ? `${chuGoc}\n\n${noiDung}` : noiDung;
      if (msg.historyRowId !== undefined) {
        setMessageContent(msg.historyRowId, msg.text);
      }
    }

    // 2. File trong tin nhắn được trích dẫn (quote/reply)
    const qDk = msg.trichDan?.dinhKem;
    if (qDk?.url && qDk.ten.toLowerCase().endsWith(".docx")) {
      const noiDungTrichDan = await trichXuatDocxTuUrl(qDk.url, qDk.ten, taiFile);
      msg.text = `${msg.text}\n\n[Trích dẫn nội dung file Word: ${qDk.ten}]\n${noiDungTrichDan}`;
      if (msg.historyRowId !== undefined) {
        setMessageContent(msg.historyRowId, msg.text);
      }
    }
  }
}

/** Xử lý trích xuất ngầm cho tin nhắn đến (nhánh passive listening khi ghi tin) */
export function xuLyDocxTinDen(accountId: string, msg: ParsedMessage, rowId: number): void {
  if (!laFileDocx(msg) || !msg.dinhKem) return;
  const { url, ten } = msg.dinhKem;
  void trichXuatDocxTuUrl(url, ten)
    .then((noiDung) => {
      const chuGoc = msg.text.trim();
      const textMoi = chuGoc && chuGoc !== ten ? `${chuGoc}\n\n${noiDung}` : noiDung;
      msg.text = textMoi;
      setMessageContent(rowId, textMoi);
      log.info({ accountId, rowId, ten }, "Đã trích xuất xong nội dung file docx vào history");
    })
    .catch((err) => {
      log.warn({ accountId, rowId, ten, err }, "Không trích xuất được file docx vào history");
    });
}
