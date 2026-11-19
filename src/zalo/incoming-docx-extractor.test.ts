import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { docxChiCoAnh, docxTuXml } from "../knowledge/ooxml-zip-test-helper.js";
import type { ParsedMessage } from "./zalo-message-parser.js";
import type { RemoteFile } from "../shared/safe-remote-download.js";

let dataDir: string;
let extractor: typeof import("./incoming-docx-extractor.js");

before(async () => {
  dataDir = setupTestEnv();
  extractor = await import("./incoming-docx-extractor.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

function taoTinDocx(o: {
  ten: string;
  url: string;
  text?: string;
  rowId?: number;
}): ParsedMessage {
  return {
    accountId: "acc1",
    threadId: "t1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "u1",
    senderName: "Trần Anh Khoa",
    text: o.text ?? o.ten,
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: true,
    sentAt: "2026-11-08T12:00:00.000Z",
    loaiTin: "file",
    dinhKem: { ten: o.ten, url: o.url },
    historyRowId: o.rowId,
    rawData: {},
  };
}

describe("incoming-docx-extractor - nhận diện file docx", () => {
  it("nhận diện đúng đuôi .docx và .DOCX", () => {
    assert.equal(extractor.laFileDocx(taoTinDocx({ ten: "bao-gia.docx", url: "https://file-stal-1.dlfl.vn/x" })), true);
    assert.equal(extractor.laFileDocx(taoTinDocx({ ten: "BAO_GIA.DOCX", url: "https://file-stal-1.dlfl.vn/x" })), true);
  });

  it("từ chối các định dạng khác hoặc thiếu đính kèm", () => {
    assert.equal(extractor.laFileDocx(taoTinDocx({ ten: "bao-gia.pdf", url: "https://file-stal-1.dlfl.vn/x" })), false);
    assert.equal(extractor.laFileDocx(taoTinDocx({ ten: "bao-gia.xlsx", url: "https://file-stal-1.dlfl.vn/x" })), false);
    assert.equal(extractor.laFileDocx(taoTinDocx({ ten: "bao-gia.doc", url: "https://file-stal-1.dlfl.vn/x" })), false);
    const tinKhongDk = taoTinDocx({ ten: "x.docx", url: "" });
    tinKhongDk.dinhKem = undefined;
    assert.equal(extractor.laFileDocx(tinKhongDk), false);
  });
});

describe("incoming-docx-extractor - trích xuất nội dung", () => {
  it("từ chối URL không thuộc CDN Zalo", async () => {
    const ketQua = await extractor.trichXuatDocxTuUrl("https://evil.example.com/malicious.docx", "malicious.docx");
    assert.match(ketQua, /URL không thuộc CDN Zalo/);
  });

  it("từ chối file không có magic bytes PK", async () => {
    const mockTai = async (): Promise<RemoteFile> => ({
      data: Buffer.from("NOT_A_ZIP_FILE_DATA"),
      mediaType: "application/octet-stream",
      fileName: "not-zip.docx",
    });
    const ketQua = await extractor.trichXuatDocxTuUrl("https://file-stal-1.dlfl.vn/not-a-file", "test.docx", mockTai);
    assert.match(ketQua, /Định dạng file không hợp lệ/);
  });
});

describe("incoming-docx-extractor - nạp nội dung cho batch", () => {
  it("trích xuất nội dung và cập nhật msg.text khi có file docx hợp lệ", async () => {
    const docxBuf = docxTuXml("<w:p><w:r><w:t>Bảng báo giá 50 tấm panel Yagami</w:t></w:r></w:p>");
    const mockTai = async (): Promise<RemoteFile> => ({
      data: docxBuf,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "bao-gia.docx",
    });

    const msg = taoTinDocx({
      ten: "bao-gia-panel.docx",
      url: "https://file-stal-1.dlfl.vn/test-file.docx",
      text: "bao-gia-panel.docx",
    });

    await extractor.napNoiDungDocxChoBatch([msg], mockTai);

    assert.match(msg.text, /Bảng báo giá 50 tấm panel Yagami/);
    assert.match(msg.text, /BẮT ĐẦU NỘI DUNG FILE WORD/);
    assert.match(msg.text, /bao-gia-panel\.docx/);
  });

  it("giữ lại caption người dùng nếu khác tên file", async () => {
    const docxBuf = docxTuXml("<w:p><w:r><w:t>Nội dung hợp đồng</w:t></w:r></w:p>");
    const mockTai = async (): Promise<RemoteFile> => ({
      data: docxBuf,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "bao-gia.docx",
    });

    const msg = taoTinDocx({
      ten: "hop-dong.docx",
      url: "https://file-stal-1.dlfl.vn/hd.docx",
      text: "@Khoa - Phiên Bản Agent kiểm tra hợp đồng này giúp anh",
    });

    await extractor.napNoiDungDocxChoBatch([msg], mockTai);

    assert.match(msg.text, /@Khoa - Phiên Bản Agent kiểm tra hợp đồng này giúp anh/);
    assert.match(msg.text, /Nội dung hợp đồng/);
  });

  it("báo rõ ràng khi file docx rỗng hoặc chỉ có ảnh", async () => {
    const docxBuf = docxChiCoAnh();
    const mockTai = async (): Promise<RemoteFile> => ({
      data: docxBuf,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "bao-gia.docx",
    });

    const msg = taoTinDocx({
      ten: "chi-co-anh.docx",
      url: "https://file-stal-1.dlfl.vn/chi-co-anh.docx",
    });

    await extractor.napNoiDungDocxChoBatch([msg], mockTai);

    assert.match(msg.text, /Không đọc được chữ nào từ file docx|chỉ chứa ảnh/);
  });

  it("trích xuất nội dung file docx từ tin nhắn trích dẫn (quote/reply)", async () => {
    const docxBuf = docxTuXml("<w:p><w:r><w:t>Số lượng: 120 tấm panel tôn xốp</w:t></w:r></w:p>");
    const mockTai = async (): Promise<RemoteFile> => ({
      data: docxBuf,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "bao-gia.docx",
    });

    const msg = taoTinDocx({
      ten: "khong-co.file",
      url: "",
      text: "@Khoa - Phiên Bản Agent đọc trong file này nè",
    });
    msg.dinhKem = undefined;
    msg.trichDan = {
      nguoiGui: "Trần Anh Khoa",
      noiDung: "BÁO GIÁ_CÔNG TY YAGAMI CENTRAL PRODUCTION.docx",
      dinhKem: {
        ten: "BÁO GIÁ_CÔNG TY YAGAMI CENTRAL PRODUCTION.docx",
        url: "https://file-stal-1.dlfl.vn/f-quote.docx",
      },
    };

    await extractor.napNoiDungDocxChoBatch([msg], mockTai);

    assert.match(msg.text, /@Khoa - Phiên Bản Agent đọc trong file này nè/);
    assert.match(msg.text, /120 tấm panel tôn xốp/);
    assert.match(msg.text, /Trích dẫn nội dung file Word: BÁO GIÁ_CÔNG TY YAGAMI CENTRAL PRODUCTION\.docx/);
  });
});
