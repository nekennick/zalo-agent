import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

let dataDir: string;
let vietQrRoutes: typeof import("./vietqr-routes.js").vietQrRoutes;
let history: typeof import("../../conversation/history-store.js");
let app: Hono;

before(async () => {
  dataDir = setupTestEnv();
  history = await import("../../conversation/history-store.js");
  const mod = await import("./vietqr-routes.js");
  vietQrRoutes = mod.vietQrRoutes;

  app = new Hono().route("/api/vietqr", vietQrRoutes);
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

describe("vietqr-routes API", () => {
  it("GET /api/vietqr/banks trả về danh sách ngân hàng", async () => {
    const res = await app.request("/api/vietqr/banks");
    assert.equal(res.status, 200);
    const data = (await res.json()) as { banks: { code: string }[] };
    assert.ok(Array.isArray(data.banks));
    assert.ok(data.banks.some((b) => b.code === "vietinbank"));
  });

  it("GET /api/vietqr/accounts trả về danh sách tài khoản", async () => {
    const res = await app.request("/api/vietqr/accounts");
    assert.equal(res.status, 200);
    const data = (await res.json()) as { accounts: unknown[] };
    assert.ok(Array.isArray(data.accounts));
    assert.ok(data.accounts.length >= 1);
  });

  it("POST, PATCH, DELETE /api/vietqr/accounts", async () => {
    // 1. Thêm mới
    const createRes = await app.request("/api/vietqr/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bankCode: "vcb",
        bankName: "Vietcombank",
        accountNumber: "999888777",
        accountHolder: "TRAN ANH KHOA",
        nickname: "Anh Khoa",
        isDefault: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { ok: boolean; account: { id: string } };
    assert.ok(created.ok);
    const accId = created.account.id;

    // 2. Sửa
    const patchRes = await app.request(`/api/vietqr/accounts/${accId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Khoa Sếp" }),
    });
    assert.equal(patchRes.status, 200);

    // 3. Xóa
    const delRes = await app.request(`/api/vietqr/accounts/${accId}`, {
      method: "DELETE",
    });
    assert.equal(delRes.status, 200);
  });
});
