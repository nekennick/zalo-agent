import { findBank } from "../conversation/vietqr-banks.js";
import { createLogger } from "./logger.js";

const log = createLogger("vietqr-generator");

export type VietQrImageParams = {
  bankCode: string;
  bankBin?: string;
  accountNumber: string;
  amount?: number;
  memo?: string;
  accountHolder?: string;
  template?: "compact2" | "compact" | "qr_only" | "print";
};

export function boDauTiengViet(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tạo URL ảnh VietQR chuẩn Napas 247 từ dịch vụ img.vietqr.io (fallback).
 */
export function taoDuongDanVietQr(params: VietQrImageParams): string {
  const bank = encodeURIComponent(params.bankCode.trim());
  const acc = encodeURIComponent(params.accountNumber.trim());
  const template = params.template ?? "compact2";

  const url = new URL(`https://img.vietqr.io/image/${bank}-${acc}-${template}.png`);

  if (params.amount !== undefined && params.amount > 0) {
    url.searchParams.set("amount", String(Math.round(params.amount)));
  }

  if (params.memo) {
    const cleanMemo = boDauTiengViet(params.memo).slice(0, 50);
    if (cleanMemo) url.searchParams.set("addInfo", cleanMemo);
  }

  if (params.accountHolder) {
    const cleanHolder = boDauTiengViet(params.accountHolder).toUpperCase().slice(0, 50);
    if (cleanHolder) url.searchParams.set("accountName", cleanHolder);
  }

  return url.toString();
}

/**
 * Tải Buffer hình ảnh mã QR chuẩn PNG (bitmap) từ VietQR.
 *
 * Lưu ý quan trọng:
 * - Dịch vụ `img.vietqr.io` trả về vector SVG (dù đuôi URL là .png), mobile hiển thị được
 *   nhưng Zalo Desktop (PC) bị lỗi decoder hiển thị màn hình trắng xám và xoay loading.
 * - API `https://api.vietqr.io/v2/generate` trả về base64 của file PNG thật (magic bytes 89 50 4E 47),
 *   giúp cả Zalo Mobile lẫn Zalo PC hiển thị rõ nét 100%.
 */
export async function taiBufferVietQr(params: VietQrImageParams): Promise<Buffer | null> {
  const cleanHolder = params.accountHolder
    ? boDauTiengViet(params.accountHolder).toUpperCase().slice(0, 50)
    : "CHU TAI KHOAN";
  const cleanMemo = params.memo ? boDauTiengViet(params.memo).slice(0, 50) : undefined;
  const template = params.template ?? "compact2";

  // Tìm mã BIN 6 chữ số
  const bin =
    params.bankBin?.trim() ||
    findBank(params.bankCode)?.bin ||
    (/^\d{6}$/.test(params.bankCode.trim()) ? params.bankCode.trim() : null);

  if (bin) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch("https://api.vietqr.io/v2/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNo: params.accountNumber.trim(),
          accountName: cleanHolder,
          acqId: bin,
          amount: params.amount && params.amount > 0 ? Math.round(params.amount) : undefined,
          addInfo: cleanMemo,
          format: "text",
          template,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const json = (await res.json()) as {
          code?: string;
          desc?: string;
          data?: { qrDataURL?: string };
        };

        if (json.code === "00" && json.data?.qrDataURL) {
          const base64Data = json.data.qrDataURL.replace(/^data:image\/\w+;base64,/, "");
          const buf = Buffer.from(base64Data, "base64");
          if (buf.length > 0) {
            log.info(
              { bankBin: bin, acc: params.accountNumber, bytes: buf.length },
              "Tạo ảnh PNG VietQR chuẩn qua API v2 thành công",
            );
            return buf;
          }
        } else {
          log.warn({ code: json.code, desc: json.desc }, "API VietQR v2 trả về mã phản hồi không thành công");
        }
      } else {
        log.warn({ status: res.status }, "API VietQR v2 trả về mã lỗi HTTP");
      }
    } catch (err) {
      log.warn({ err }, "Lỗi khi gọi API VietQR v2, chuyển sang fallback URL");
    }
  }

  // Fallback: Tải từ img.vietqr.io nếu API v2 không phản hồi
  const directUrl = taoDuongDanVietQr(params);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(directUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn({ status: res.status, url: directUrl }, "Fallback img.vietqr.io trả về lỗi HTTP");
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    log.error({ err, url: directUrl }, "Lỗi khi tải ảnh fallback VietQR");
    return null;
  }
}
