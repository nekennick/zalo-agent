import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let tenantStore: typeof import("./facebook-tenant-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../conversation/database.js");
  tenantStore = await import("./facebook-tenant-store.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("Facebook Tenant Store (Multi-tenant SaaS)", () => {
  const pageId = "fb_test_page_999";

  beforeEach(() => {
    tenantStore.deleteFacebookPage(pageId);
  });

  it("thêm và đọc thông tin Page với token được mã hóa an toàn", () => {
    const rawToken = "EAA_test_secret_token_123456789";
    const saved = tenantStore.saveFacebookPage({
      pageId,
      pageName: "Trà Sữa Nhà Làm",
      accessToken: rawToken,
      agentId: "cskh",
      planName: "basic",
      messagesQuota: 50,
      durationDays: 30,
    });

    assert.equal(saved.pageId, pageId);
    assert.equal(saved.pageName, "Trà Sữa Nhà Làm");
    assert.equal(saved.accessToken, rawToken); // Token đọc ra từ store đã được giải mã đúng
    assert.equal(saved.messagesQuota, 50);
    assert.equal(saved.messagesUsed, 0);

    const retrieved = tenantStore.getFacebookPage(pageId);
    assert.ok(retrieved);
    assert.equal(retrieved.pageName, "Trà Sữa Nhà Làm");
  });

  it("danh sách Public View che giấu token và tính toán số ngày còn lại", () => {
    tenantStore.saveFacebookPage({
      pageId,
      pageName: "Tiệm Bánh Ngọt",
      accessToken: "EAA_very_secret_token_abcdef",
      agentId: "cskh",
      durationDays: 15,
    });

    const pages = tenantStore.listFacebookPages();
    const found = pages.find((p) => p.pageId === pageId);
    assert.ok(found);
    assert.notEqual(found.maskedToken, "EAA_very_secret_token_abcdef");
    assert.match(found.maskedToken, /\.\.\./); // Token bị che bằng dấu ...
    assert.equal(found.daysRemaining, 15);
    assert.equal(found.isExpired, false);
    assert.equal(found.isQuotaExceeded, false);
  });

  it("kiểm soát hạn mức tin nhắn (Quota) và tạm dừng khi chạm trần", () => {
    tenantStore.saveFacebookPage({
      pageId,
      pageName: "Quán Ăn Thử Nghiệm",
      accessToken: "token_123",
      agentId: "cskh",
      messagesQuota: 2, // Hạn mức chỉ 2 tin
    });

    // Lần 1: Được phép
    const res1 = tenantStore.checkAndIncrementUsage(pageId);
    assert.equal(res1.allowed, true);
    assert.equal(res1.used, 1);

    // Lần 2: Được phép
    const res2 = tenantStore.checkAndIncrementUsage(pageId);
    assert.equal(res2.allowed, true);
    assert.equal(res2.used, 2);

    // Lần 3: Đã chạm trần 2 tin -> Bị chặn
    const res3 = tenantStore.checkAndIncrementUsage(pageId);
    assert.equal(res3.allowed, false);
    assert.equal(res3.reason, "QUOTA_EXCEEDED");
    assert.equal(res3.used, 2);
  });

  it("tạm dừng và mở lại Fanpage", () => {
    tenantStore.saveFacebookPage({
      pageId,
      pageName: "Shop Áo Cưới",
      accessToken: "token_123",
      agentId: "cskh",
    });

    tenantStore.updateFacebookPageStatus(pageId, "paused");
    const checkPaused = tenantStore.checkAndIncrementUsage(pageId);
    assert.equal(checkPaused.allowed, false);
    assert.equal(checkPaused.reason, "PAUSED");

    tenantStore.updateFacebookPageStatus(pageId, "active");
    const checkActive = tenantStore.checkAndIncrementUsage(pageId);
    assert.equal(checkActive.allowed, true);
  });

  it("gia hạn thuê bao thành công và reset số tin nhắn đã dùng", () => {
    tenantStore.saveFacebookPage({
      pageId,
      pageName: "Cafe Mùa Thu",
      accessToken: "token_123",
      agentId: "cskh",
      messagesQuota: 10,
    });

    // Dùng hết quota
    for (let i = 0; i < 10; i++) {
      tenantStore.checkAndIncrementUsage(pageId);
    }
    assert.equal(tenantStore.getFacebookPage(pageId)?.messagesUsed, 10);

    // Gia hạn thêm 30 ngày lên gói Pro
    const extendRes = tenantStore.extendFacebookSubscription({
      pageId,
      additionalDays: 30,
      planName: "pro",
    });

    assert.equal(extendRes.success, true);
    assert.equal(extendRes.planName, "pro");

    const updated = tenantStore.getFacebookPage(pageId)!;
    assert.equal(updated.status, "active");
    assert.equal(updated.planName, "pro");
    assert.equal(updated.messagesQuota, 10000);
    assert.equal(updated.messagesUsed, 0); // Đã reset về 0 tin
  });
});
