import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

let dataDir: string;
let closeDatabase: () => void;
let extractFirstName: typeof import("./record-inventory-import-tool.js").extractFirstName;
let findSentAtForInventoryItem: typeof import("./record-inventory-import-tool.js").findSentAtForInventoryItem;
let parseItemsFromText: typeof import("./record-inventory-import-tool.js").parseItemsFromText;

let isItemInCurrentBatch: typeof import("./record-inventory-import-tool.js").isItemInCurrentBatch;
let findSourceMessageForInventoryItem: typeof import("./record-inventory-import-tool.js").findSourceMessageForInventoryItem;
let createRecordInventoryImportTool: typeof import("./record-inventory-import-tool.js").createRecordInventoryImportTool;

before(async () => {
  dataDir = setupTestEnv();
  ({ closeDatabase } = await import("../../conversation/database.js"));
  ({
    extractFirstName,
    findSentAtForInventoryItem,
    parseItemsFromText,
    createRecordInventoryImportTool,
    isItemInCurrentBatch,
    findSourceMessageForInventoryItem,
  } = await import("./record-inventory-import-tool.js"));
});

after(async () => {
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("record-inventory-import-tool", () => {
  it("extractFirstName tách đúng tên từ họ và tên đầy đủ", () => {
    assert.equal(extractFirstName("Trần Anh Khoa"), "Khoa");
    assert.equal(extractFirstName("Bích Phượng"), "Phượng");
    assert.equal(extractFirstName("Châu"), "Châu");
    assert.equal(extractFirstName("  Nguyễn Văn A  "), "A");
    assert.equal(extractFirstName(""), "");
  });

  it("findSentAtForInventoryItem lấy đúng sentAt từ batch tin nhắn theo tên và số lượng", () => {
    const mockCtx = {
      message: { sentAt: "2026-11-21T08:00:00.000Z" },
      batch: [
        { text: "Nhận 302c chén", sentAt: "2026-11-21T08:01:35.484Z" },
        { text: "Nhận 501c muỗng", sentAt: "2026-11-21T08:02:10.386Z" },
        { text: "Nhận 80c dĩa", sentAt: "2026-11-21T08:03:26.291Z" },
      ],
    } as never;

    const t1 = findSentAtForInventoryItem({ tenHang: "Chén", soLuong: 302 }, mockCtx);
    const t2 = findSentAtForInventoryItem({ tenHang: "Muỗng", soLuong: 501 }, mockCtx);
    const t3 = findSentAtForInventoryItem({ tenHang: "Dĩa", soLuong: 80 }, mockCtx);
    const tFallback = findSentAtForInventoryItem({ tenHang: "Món lạ", soLuong: 10 }, mockCtx);

    assert.equal(t1, "2026-11-21T08:01:35.484Z");
    assert.equal(t2, "2026-11-21T08:02:10.386Z");
    assert.equal(t3, "2026-11-21T08:03:26.291Z");
    assert.equal(tFallback, "2026-11-21T08:00:00.000Z");
  });

  it("parseItemsFromText bóc tách chính xác số lượng và tên món từ tin nhắn báo hàng", () => {
    const r1 = parseItemsFromText("Nhận 451c dĩa nhỏ");
    assert.deepEqual(r1, [{ tenHang: "dĩa nhỏ", soLuong: 451, dvt: "cái" }]);

    const r2 = parseItemsFromText("400c chén");
    assert.deepEqual(r2, [{ tenHang: "chén", soLuong: 400, dvt: "cái" }]);

    const r3 = parseItemsFromText("Nhận 15 cái dĩa lớn\nNhận 500c chén chấm 2 ngăn");
    assert.deepEqual(r3, [
      { tenHang: "dĩa lớn", soLuong: 15, dvt: "cái" },
      { tenHang: "chén chấm 2 ngăn", soLuong: 500, dvt: "cái" },
    ]);
  });

  it("giữ đơn vị của ba món cải muối, kể cả khi viết trên một dòng", () => {
    const expected = [
      { tenHang: "miến hàn", soLuong: 300, dvt: "kg" },
      { tenHang: "bột ớt", soLuong: 700, dvt: "kg" },
      { tenHang: "cải muối", soLuong: 20, dvt: "thùng" },
    ];
    assert.deepEqual(parseItemsFromText("Nhận 300kg miến hàn\n700kg bột ớt\n20th cải muối"), expected);
    assert.deepEqual(parseItemsFromText("Nhận: 300kg miến hàn,700 kg bột ớt; 20 th cải muối"), expected);
    assert.deepEqual(parseItemsFromText("Đã về\n- miến hàn 300 kg\n- 700kg bột ớt\n- cải muối 20th"), expected);
    assert.deepEqual(parseItemsFromText("Nhận 89b tương đỏ"), [{ tenHang: "tương đỏ", soLuong: 89, dvt: "b" }]);
    assert.deepEqual(parseItemsFromText("Thứ 2 về 2000 thùng mì"), []);
    assert.deepEqual(parseItemsFromText("2 ngày nữa"), []);
    assert.deepEqual(parseItemsFromText("Nhận 20 thùng"), []);
    assert.deepEqual(parseItemsFromText("Nhận 15 dĩa lớn"), [{ tenHang: "dĩa lớn", soLuong: 15 }]);
  });

  it("không mượn số lượng trên dòng khác trong cùng tin", () => {
    const message = { text: "Nhận 300kg miến hàn\n700kg bột ớt\n20th cải muối" };
    assert.equal(isItemInCurrentBatch({ tenHang: "bột ớt", soLuong: 300 }, { message } as never), false);
    assert.equal(isItemInCurrentBatch({ tenHang: "cải muối", soLuong: 20 }, { message } as never), true);
  });

  it("từ chối thực thi khi tin nhắn không nằm trong nhóm Báo Nhận Hàng Kho Tổng", async () => {
    const mockCtx = {
      message: {
        threadId: "7602326176173373889", // Nhóm Nhân Viên Kho Yagami Cao Lãnh
        text: "Thứ 2 về 2000th luôn nha em",
        senderName: "Bích Phượng",
      },
    } as never;

    const toolInstance = createRecordInventoryImportTool(mockCtx);
    const result = (await (toolInstance as unknown as { execute: Function }).execute(
      { items: [{ tenHang: "về 2000th luôn nha em", soLuong: 2, dvt: "cái" }] },
      { toolCallId: "call_1", messages: [] },
    )) as { success: boolean; message: string };

    assert.equal(result.success, false);
    assert.match(result.message, /chỉ hoạt động trong nhóm Báo Nhận Hàng Kho Tổng/i);
  });

  it("isItemInCurrentBatch nhận biết chính xác món có trong batch hay ảo giác từ tin cũ", () => {
    const mockCtx = {
      message: { text: "Nhận 4c lồng đèn dài" },
      batch: [{ text: "Nhận 4c lồng đèn dài" }],
    } as never;

    assert.equal(isItemInCurrentBatch({ tenHang: "lồng đèn dài", soLuong: 4 }, mockCtx), true);
    assert.equal(isItemInCurrentBatch({ tenHang: "lồng đèn", soLuong: 4 }, mockCtx), true);
    // Các món từ tin nhắn cũ của ngày hôm trước phải bị phát hiện là false
    assert.equal(isItemInCurrentBatch({ tenHang: "bò úc lát", soLuong: 18.5 }, mockCtx), false);
    assert.equal(isItemInCurrentBatch({ tenHang: "bò mỹ lát", soLuong: 324.5 }, mockCtx), false);
    assert.equal(isItemInCurrentBatch({ tenHang: "heo xay", soLuong: 108 }, mockCtx), false);
  });

  it("findSourceMessageForInventoryItem tìm đúng tin nhắn và người gửi trong batch", () => {
    const mockCtx = {
      message: { text: "Nhận 15c dĩa lớn", senderName: "Nhân", senderId: "id-nhan" },
      batch: [
        { text: "Nhận 60c ly đen", sentAt: "2026-11-21T07:59:27.278Z", senderName: "Nhân", senderId: "id-nhan" },
        { text: "Nhận 302c chén", sentAt: "2026-11-21T08:01:35.484Z", senderName: "Nhân", senderId: "id-nhan" },
        { text: "Nhận 15c dĩa lớn", sentAt: "2026-11-21T08:09:48.594Z", senderName: "Nhân", senderId: "id-nhan" },
      ],
    } as never;

    const sourceLy = findSourceMessageForInventoryItem({ tenHang: "ly đen", soLuong: 60 }, mockCtx);
    assert.equal(sourceLy.rawMessage, "Nhận 60c ly đen");
    assert.equal(sourceLy.sentAt, "2026-11-21T07:59:27.278Z");

    const sourceDia = findSourceMessageForInventoryItem({ tenHang: "dĩa lớn", soLuong: 15 }, mockCtx);
    assert.equal(sourceDia.rawMessage, "Nhận 15c dĩa lớn");
    assert.equal(sourceDia.sentAt, "2026-11-21T08:09:48.594Z");
  });
});
