import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./vietqr-bank-store.js");
let history: typeof import("./history-store.js");

before(async () => {
  dataDir = setupTestEnv();
  history = await import("./history-store.js");
  store = await import("./vietqr-bank-store.js");
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

describe("vietqr-bank-store", () => {
  it("khởi tạo bảng có sẵn tài khoản mẫu Phan Thanh Dung", () => {
    const list = store.listVietQrAccounts();
    assert.ok(list.length >= 1);
    const dung = list.find((a) => a.accountNumber === "107001620872");
    assert.ok(dung);
    assert.equal(dung?.accountHolder, "PHAN THANH DUNG");
    assert.equal(dung?.bankCode, "vietinbank");
    assert.equal(dung?.isDefault, true);
  });

  it("findVietQrAccountByKeyword tìm đúng theo biệt danh hoặc tên", () => {
    assert.ok(store.findVietQrAccountByKeyword("chị Dung"));
    assert.ok(store.findVietQrAccountByKeyword("Dung"));
    assert.ok(store.findVietQrAccountByKeyword("Phan Thanh Dung"));
    assert.equal(store.findVietQrAccountByKeyword("Người Không Tồn Tại"), null);
  });

  it("thêm, sửa, xóa tài khoản VietQR mới", () => {
    const created = store.createVietQrAccount({
      bankCode: "mbbank",
      bankName: "MBBank",
      accountNumber: "0987654321",
      accountHolder: "TRAN ANH KHOA",
      nickname: "Khoa, Anh Khoa",
      isDefault: false,
    });

    assert.equal(created.accountHolder, "TRAN ANH KHOA");
    assert.equal(created.accountNumber, "0987654321");

    const found = store.findVietQrAccountByKeyword("anh Khoa");
    assert.equal(found?.id, created.id);

    // Cập nhật
    store.updateVietQrAccount(created.id, { nickname: "Khoa, Sếp Khoa", isDefault: true });
    const updated = store.getVietQrAccount(created.id);
    assert.equal(updated?.nickname, "Khoa, Sếp Khoa");
    assert.equal(updated?.isDefault, true);

    // Xóa
    assert.equal(store.deleteVietQrAccount(created.id), true);
    assert.equal(store.getVietQrAccount(created.id), null);
  });
});
