import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let closeDatabase: () => void;
let isLikelyInventoryReportMessage: typeof import("./warehouse-safety-net.js").isLikelyInventoryReportMessage;

before(async () => {
  dataDir = setupTestEnv();
  ({ closeDatabase } = await import("../conversation/database.js"));
  ({ isLikelyInventoryReportMessage } = await import("./warehouse-safety-net.js"));
});

after(async () => {
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("isLikelyInventoryReportMessage - Lọc tin nhắn nhóm kho", () => {
  it("loại bỏ các câu giao tiếp, tag tên người, chào hỏi không có số lượng", () => {
    assert.equal(isLikelyInventoryReportMessage("@Trần Anh Khoa đây anh ơi"), false);
    assert.equal(isLikelyInventoryReportMessage("Dạ anh ơi"), false);
    assert.equal(isLikelyInventoryReportMessage("Ok anh"), false);
    assert.equal(isLikelyInventoryReportMessage("Cảm ơn anh nha"), false);
    assert.equal(isLikelyInventoryReportMessage("@Kiệt xem giúp em"), false);
    assert.equal(isLikelyInventoryReportMessage("Hôm nay có ai trực kho không?"), false);
    assert.equal(isLikelyInventoryReportMessage(""), false);
    assert.equal(isLikelyInventoryReportMessage("   "), false);
  });

  it("nhận diện đúng các tin nhắn báo nhận hàng có số lượng", () => {
    assert.equal(isLikelyInventoryReportMessage("Nhận 451c dĩa nhỏ"), true);
    assert.equal(isLikelyInventoryReportMessage("400c chén"), true);
    assert.equal(isLikelyInventoryReportMessage("324,5kg bò mỹ lát"), true);
    assert.equal(isLikelyInventoryReportMessage("Thứ 2 về 2000 thùng mì"), false);
    assert.equal(isLikelyInventoryReportMessage("15h kiểm tra giúp em"), false);
    assert.equal(isLikelyInventoryReportMessage("Nhận 15 dĩa lớn"), true);
    assert.equal(isLikelyInventoryReportMessage("Nhận 45,1kg bún ( đã trừ khay )"), true);
  });
});
