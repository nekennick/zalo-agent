import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boDauTiengViet, taoDuongDanVietQr, taiBufferVietQr } from "./vietqr-generator.js";

describe("vietqr-generator", () => {
  it("boDauTiengViet loại bỏ dấu tiếng Việt và ký tự đặc biệt", () => {
    assert.equal(boDauTiengViet("Trần Anh Khoa - Bún bò"), "Tran Anh Khoa Bun bo");
    assert.equal(boDauTiengViet("Đỗ Đình Đồng"), "Do Dinh Dong");
  });

  it("taoDuongDanVietQr sinh URL chuẩn có amount, addInfo, accountName", () => {
    const url = taoDuongDanVietQr({
      bankCode: "vietinbank",
      accountNumber: "107001620872",
      amount: 45000,
      memo: "Khoa tra tien bun bo",
      accountHolder: "PHAN THANH DUNG",
    });

    assert.ok(url.startsWith("https://img.vietqr.io/image/vietinbank-107001620872-compact2.png"));
    assert.ok(url.includes("amount=45000"));
    assert.ok(url.includes("addInfo=Khoa+tra+tien+bun+bo"));
    assert.ok(url.includes("accountName=PHAN+THANH+DUNG"));
  });

  it("taiBufferVietQr gọi API v2/generate và giải mã ra buffer PNG chuẩn", async () => {
    const fetchThat = globalThis.fetch;
    const pngFakeBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const urlStr = String(input);
      if (urlStr.includes("api.vietqr.io/v2/generate")) {
        return new Response(
          JSON.stringify({
            code: "00",
            desc: "Gen VietQR successful!",
            data: {
              qrDataURL: `data:image/png;base64,${pngFakeBase64}`,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    }) as typeof fetch;

    try {
      const buf = await taiBufferVietQr({
        bankCode: "vietinbank",
        accountNumber: "107001620872",
        amount: 23000,
        memo: "Khoa tra tien",
        accountHolder: "PHAN THANH DUNG",
      });

      assert.ok(buf);
      assert.equal(buf[0], 0x89);
      assert.equal(buf[1], 0x50);
      assert.equal(buf[2], 0x4e);
      assert.equal(buf[3], 0x47);
    } finally {
      globalThis.fetch = fetchThat;
    }
  });

  it("taiBufferVietQr fallback sang direct url khi API v2 lỗi", async () => {
    const fetchThat = globalThis.fetch;
    const directBuffer = Buffer.from("fake-direct-image");

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const urlStr = String(input);
      if (urlStr.includes("api.vietqr.io/v2/generate")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (urlStr.includes("img.vietqr.io")) {
        return new Response(directBuffer, { status: 200 });
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    }) as typeof fetch;

    try {
      const buf = await taiBufferVietQr({
        bankCode: "vietinbank",
        accountNumber: "107001620872",
      });

      assert.ok(buf);
      assert.equal(buf.toString(), "fake-direct-image");
    } finally {
      globalThis.fetch = fetchThat;
    }
  });
});
