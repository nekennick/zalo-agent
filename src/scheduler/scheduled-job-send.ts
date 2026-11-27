/**
 * Gửi THẬT 1 lượt job: guard trước khi gửi (giành 1 suất trần ngày NGUYÊN
 * TỬ), gửi qua `deliverProactively`, rồi chốt sổ. Tách khỏi
 * `scheduled-job-conclude.ts` (giữ phần kết luận CHUNG, không riêng gì việc
 * gửi) để cả 2 file không vượt ngưỡng 200 dòng.
 */

import { appendMessage } from "../conversation/history-store.js";
import type { ScheduledAttachment } from "../agent/tools/tool-catalog-types.js";
import { createLogger } from "../shared/logger.js";
import { dinhDangNeuBat } from "../zalo/prepare-outgoing-text.js";
import { enqueueSend } from "../middleware/rate-limiter.js";
import { laLoiMayChuTuChoi, sendReplyInParts, type ReplyResult, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import {
  checkAccountAndThreadReady,
  recordProactiveSend,
  refundProactiveSlot,
  reserveProactiveSlot,
} from "./proactive-send-guard.js";
import { deliverProactively } from "./proactive-send-queue.js";
import { concludeBlockedNotRun, concludeDeliveryFailed, conclude } from "./scheduled-job-conclude.js";
import { concludeCapBlocked } from "./scheduled-job-cap-guard.js";
import { finishRun } from "./job-run-log-store.js";
import type { ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("run-scheduled-job");

/**
 * Kiểm guard NGAY TRƯỚC LÚC GỬI: account/thread recheck FRESH (đã kiểm ở
 * `scheduler-loop.ts` trước clear-before-dispatch, nhưng lượt agent có thể
 * chạy dài) + GIÀNH 1 suất trần ngày NGUYÊN TỬ (`reserveProactiveSlot`).
 *
 * Chặn thì tự lo hết rồi trả `true` - caller dừng lại. Trả `false` nghĩa là
 * ĐÃ GIÀNH ĐƯỢC 1 suất - caller BẮT BUỘC gọi `sendAndConclude` ngay sau.
 */
export async function blockedByGuard(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  scheduledFor: string,
  /** Mốc của LƯỢT xử lý - xem `RunScheduledJobOptions.now`. Bắt buộc, không mặc định. */
  now: Date,
  turnId?: number,
): Promise<boolean> {
  const fresh = checkAccountAndThreadReady(job.accountId, job.threadId);
  if (!fresh.ok) {
    concludeBlockedNotRun(job, runId, fresh.reason, scheduledFor, turnId);
    return true;
  }

  const slot = reserveProactiveSlot(job.accountId, job.threadId, timeZone, now);
  if (!slot.ok) {
    await concludeCapBlocked(job, runId, slot.reason, timeZone, now, {
      notifyCapHitOnce: slot.notifyCapHitOnce,
      target,
      turnId,
    });
    return true;
  }

  return false;
}

/**
 * Gửi + ghi history + đếm trần + chốt run - MỘT bước, đi qua
 * `deliverProactively`. BẮT BUỘC gọi SAU khi `blockedByGuard` trả `false`.
 *
 * Gửi được (dù chỉ 1 phần) thì suất đã giành coi là DÙNG - cộng thêm phần CÒN
 * LẠI nếu `sentParts` > 1. KHÔNG gửi được GÌ thì hoàn lại suất rồi tính vào
 * `delivery_attempts` (`concludeDeliveryFailed`) - gửi hỏng không được phép
 * giết job ngay (Finding 1).
 *
 * TỪ LÚC `reply.deliveredText` khác rỗng (Mục 2, vòng 3): tin ĐÃ RA ZALO
 * THẬT, KHÔNG CÒN ĐƯỜNG NÀO được phép rơi vào `concludeDeliveryFailed` nữa -
 * dù ghi history hay bước chốt sổ có hỏng thế nào. Bản trước để lỗi ở các
 * bước ĐÓ ném ra ngoài (không try/catch riêng), catch của `run-scheduled-job.ts`
 * bắt nhầm thành "chưa gửi" và RETRY - gửi TRÙNG đúng nội dung tới 3 lần dù
 * tin đầu tiên đã tới nơi.
 */
export async function sendAndConclude(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  text: string,
  scheduledFor: string,
  /**
   * PHẢI là ĐÚNG mốc mà `blockedByGuard` đã dùng để giành suất. Lệch một cái
   * là hoàn suất trả nhầm ngày và suất đã giành không ai đòi lại được.
   */
  now: Date,
  turnId?: number,
  attachments?: ScheduledAttachment[],
): Promise<void> {
  const reply = await deliverProactively(target.threadKey, async () => {
    // Dịch markdown SÁT lúc gửi, không sớm hơn: chữ ghi vào history bên dưới
    // phải đúng bằng chữ người dùng thấy trên Zalo.
    const { text: chuGui, styles } = dinhDangNeuBat(text);
    const r = attachments && attachments.length > 0
      ? await sendAttachmentsWithCaption(target, chuGui, styles, attachments.map((a) => a.filePath))
      : await sendReplyInParts(target, chuGui, styles);
    if (r.deliveredText) {
      try {
        appendMessage(job.accountId, job.threadId, { role: "assistant", content: r.deliveredText });
      } catch (err) {
        // Tin ĐÃ RA Zalo thật - ghi history hỏng KHÔNG được biến "đã gửi"
        // thành "chưa gửi". Gắn vào `r.error` (nếu CHƯA có lỗi ưu tiên hơn) để
        // nhánh dưới vẫn coi là ĐÃ GIAO nhưng ghi run 'error' cho dashboard thấy.
        log.error({ err, jobId: job.id }, "Ghi history sau khi gửi thành công bị lỗi");
        if (!r.error) r.error = err;
      }
    }
    return r;
  });

  if (!reply.deliveredText) {
    refundProactiveSlot(job.accountId, job.threadId, timeZone, now);
    concludeDeliveryFailed(job, runId, scheduledFor, errorText(reply.error) ?? "Gửi thất bại không rõ nguyên nhân.", turnId);
    return;
  }

  try {
    if (reply.sentParts > 1) {
      recordProactiveSend(job.accountId, job.threadId, timeZone, reply.sentParts - 1, now);
    }
    concludeDelivered(job, runId, reply, turnId);
  } catch (err) {
    concludePostSendBookkeepingFailed(job, runId, reply, err, turnId);
  }
}

/** Chốt run khi ĐÃ chắc chắn gửi được - status theo `reply.error` (có thể là lỗi ghi history gắn vào ở trên) */
function concludeDelivered(job: ScheduledJob, runId: number, reply: ReplyResult, turnId?: number): void {
  if (reply.error) {
    conclude(job, runId, {
      status: "error",
      turnId,
      detail: errorText(reply.error) ?? "Lỗi không rõ nguyên nhân.",
      deliveredChars: reply.deliveredText.length,
    });
    return;
  }
  conclude(job, runId, { status: "ok", turnId, detail: "Đã gửi.", deliveredChars: reply.deliveredText.length });
}

/**
 * Chốt sổ tự nó hỏng NGAY SAU khi đã gửi thành công (Mục 2, vòng 3) - PHẢI
 * markRun (không markRun thì `next_run_at`, đã bị clear-before-dispatch đưa
 * về NULL, đứng yên mãi mãi - job "kẹt xác sống": enabled=true nhưng không
 * tick nào còn nhặt lại được). Lưới đỡ 2 lớp: `conclude()` hỏng nữa (cực
 * hiếm) thì `finishRun` thô để ít nhất đưa run ra khỏi 'running'.
 */
function concludePostSendBookkeepingFailed(
  job: ScheduledJob,
  runId: number,
  reply: ReplyResult,
  err: unknown,
  turnId?: number,
): void {
  log.error({ err, jobId: job.id }, "Chốt sổ sau khi gửi thành công bị lỗi - ghi run 'error' + markRun, KHÔNG retry");
  try {
    conclude(job, runId, {
      status: "error",
      turnId,
      detail: `Gửi thành công nhưng chốt sổ lỗi: ${errorText(err) ?? "không rõ"}`,
      deliveredChars: reply.deliveredText.length,
    });
  } catch (err2) {
    log.error({ err: err2, jobId: job.id }, "conclude() cũng lỗi ở lưới đỡ cuối - chỉ còn finishRun thô");
    try {
      finishRun(runId, { status: "error", turnId, detail: "Gửi thành công nhưng chốt sổ lỗi liên tiếp 2 lớp." });
    } catch {
      /* đã cố hết sức - 1 lỗi ghi log không được giết cả tiến trình */
    }
  }
}

function errorText(err: unknown): string | undefined {
  if (err === undefined) return undefined;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Gửi file/ảnh đính kèm qua `target.guiMotDoan` (nằm trong `deliverProactively`
 * của scheduler). Fallback sang chữ trơn nếu Zalo từ chối styles của caption.
 */
async function sendAttachmentsWithCaption(
  target: ReplyTarget,
  caption: string,
  styles: ReturnType<typeof dinhDangNeuBat>["styles"],
  attachmentPaths: string[],
): Promise<ReplyResult> {
  const doanStyles = target.mangDinhDang === false ? undefined : styles;
  const label = `[Gửi kèm ${attachmentPaths.length} ảnh]`;
  const deliveredLabel = caption ? `${label}\n${caption}` : label;

  try {
    await enqueueSend(target.threadKey, async () => {
      try {
        return await target.guiMotDoan({
          text: caption,
          styles: doanStyles,
          attachments: attachmentPaths,
        });
      } catch (err) {
        if (!doanStyles?.length || !laLoiMayChuTuChoi(err)) throw err;
        log.warn(
          { threadId: target.threadId, soStyle: doanStyles.length, err },
          "Zalo từ chối caption ảnh có định dạng - gửi lại dạng chữ trơn",
        );
        return await target.guiMotDoan({
          text: caption,
          attachments: attachmentPaths,
        });
      }
    });
    return { deliveredText: deliveredLabel, sentParts: 1 };
  } catch (err) {
    return { deliveredText: "", sentParts: 0, error: err };
  }
}
