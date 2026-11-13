import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let bridge: typeof import("./admin-context-bridge.js");
let threads: typeof import("./thread-store.js");
let history: typeof import("./history-store.js");

before(async () => {
  dataDir = setupTestEnv();
  threads = await import("./thread-store.js");
  history = await import("./history-store.js");
  bridge = await import("./admin-context-bridge.js");
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

describe("admin-context-bridge", () => {
  it("formatAdminContextBlock trả về rỗng khi không có tin nhắn", () => {
    assert.equal(bridge.formatAdminContextBlock([]), "");
  });

  it("formatAdminContextBlock format đúng các vai và bọc trong tag <chi_dao_admin>", () => {
    const formatted = bridge.formatAdminContextBlock(
      [
        {
          id: 1,
          role: "user",
          senderName: "Trần Anh Khoa",
          content: "Giá hôm nay là 50k",
          images: [],
          createdAt: "2026-11-12T10:00:00.000Z",
        },
        {
          id: 2,
          role: "assistant",
          content: "Dạ em đã ghi nhận giá 50k",
          images: [],
          createdAt: "2026-11-12T10:01:00.000Z",
        },
      ],
      "Trần Anh Khoa",
    );

    assert.match(formatted, /<chi_dao_admin>/);
    assert.match(formatted, /<\/chi_dao_admin>/);
    assert.match(formatted, /Quản trị viên \(Trần Anh Khoa\): "Giá hôm nay là 50k"/);
    assert.match(formatted, /Bot \(trả lời Quản trị viên\): "Dạ em đã ghi nhận giá 50k"/);
  });

  it("findAdminThread tìm đúng thread từ allowlistUserIds", () => {
    threads.recordThreadActivity({
      accountId: "acc-test",
      threadId: "user-khoa",
      threadType: 0,
      displayName: "Trần Anh Khoa",
      lastSenderName: "Trần Anh Khoa",
    });

    const found = bridge.findAdminThread("acc-test", ["user-khoa"]);
    assert.ok(found);
    assert.equal(found?.threadId, "user-khoa");
    assert.equal(found?.displayName, "Trần Anh Khoa");
  });

  it("getAdminSharedContextForGroup lấy đúng nội dung khi có tin nhắn", () => {
    history.appendMessage("acc-test", "user-khoa", {
      role: "user",
      senderName: "Trần Anh Khoa",
      content: "Menu gồm bún bò và phở gà",
    });

    const block = bridge.getAdminSharedContextForGroup({
      accountId: "acc-test",
      allowlistUserIds: ["user-khoa"],
    });

    assert.match(block, /Menu gồm bún bò và phở gà/);
  });
});
