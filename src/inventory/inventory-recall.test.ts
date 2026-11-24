import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import type { Undo } from "zca-js";
import type { ToolContext } from "../agent/tools/tool-catalog-types.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

const warehouse = "515122450907591015";
const picklesReport = "Nhận 300kg miến hàn\n700kg bột ớt\n20th cải muối";
const originalCwd = process.cwd();
let dataDir: string;
let store: typeof import("./inventory-message-store.js");
let handler: typeof import("./inventory-recall-handler.js");
let inventoryTool: typeof import("../agent/tools/record-inventory-import-tool.js");
let safetyNet: typeof import("./warehouse-safety-net.js");
let db: DatabaseSync;
let closeDatabase: () => void;

before(async () => {
  dataDir = setupTestEnv();
  process.chdir(dataDir);
  ({ db, closeDatabase } = await import("../conversation/database.js"));
  store = await import("./inventory-message-store.js");
  handler = await import("./inventory-recall-handler.js");
  inventoryTool = await import("../agent/tools/record-inventory-import-tool.js");
  safetyNet = await import("./warehouse-safety-net.js");
});
beforeEach(() => { db.exec("DELETE FROM inventory_message_sources"); });
afterEach(() => { mock.restoreAll(); });
after(() => { closeDatabase(); process.chdir(originalCwd); cleanupTestEnv(dataDir); });

function message(msgId: string, text = "Nhận 324,5kg bò mỹ lát"): ParsedMessage {
  return { accountId: "warehouse-account", threadId: warehouse, msgId, cliMsgId: `cli-${msgId}`,
    text, senderId: "nhan", senderName: "Nhân", sentAt: "2026-11-21T11:13:07.000Z",
    threadType: 1, isGroup: true, isSelf: false, images: [], mentionsMe: false, rawData: {} };
}
function context(messages: ParsedMessage[]): ToolContext {
  return { message: messages.at(-1), batch: messages,
    account: { id: "warehouse-account", autoReactEnabled: false } } as ToolContext;
}
function undo(msgId: number): Undo {
  return { isGroup: true, threadId: warehouse, isSelf: false,
    data: { msgId: "undo-event-id", content: { globalMsgId: msgId } } } as Undo;
}
async function executeTool(messages: ParsedMessage[], items: { tenHang: string; soLuong: number; dvt?: string }[]) {
  const tool = inventoryTool.createRecordInventoryImportTool(context(messages));
  return await (tool.execute as Function)({ items }, { toolCallId: "test", messages: [] });
}

describe("thu hồi tin nhận hàng", () => {
  it("lưu bền dấu thu hồi và không làm sống lại tin khi nhận lại nội dung", () => {
    const msg = message("101");
    store.recallInventoryMessage(msg, "2026-11-21T11:14:00.000Z");
    store.rememberInventoryMessage(msg);
    const reopened = new DatabaseSync(path.join(dataDir, "zalo-agent.db"));
    try {
      const row = reopened.prepare("SELECT recalled_at, recall_pending, raw_message FROM inventory_message_sources").get();
      assert.deepEqual({ ...row }, { recalled_at: "2026-11-21T11:14:00.000Z", recall_pending: 1, raw_message: msg.text });
    } finally { reopened.close(); }
    assert.equal(store.isInventoryMessageRecalled(msg), true);
  });

  it("dùng mã tin gốc trong undo, chỉ xử lý nhóm kho và không lẫn tài khoản", async () => {
    const calls: unknown[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body))); return Response.json({ success: true });
    });
    await handler.handleInventoryUndo("warehouse-account", { ...undo(101), threadId: "other" });
    assert.equal(calls.length, 0);
    await handler.handleInventoryUndo("warehouse-account", undo(101));
    assert.equal(store.isInventoryMessageRecalled(message("101")), true);
    assert.equal(store.isInventoryMessageRecalled(message("undo-event-id")), false);
    assert.equal(store.isInventoryMessageRecalled({ ...message("101"), accountId: "other" }), false);
    assert.equal(store.pendingInventoryRecalls().length, 0);
    assert.deepEqual((calls[0] as Record<string, unknown>).sourceMessageId, "101");
  });

  it("dashboard mất kết nối thì giữ hàng đợi, gửi lại thành công vẫn giữ dấu thu hồi", async () => {
    mock.method(globalThis, "fetch", async () => Response.json({ success: false }, { status: 503 }));
    await handler.handleInventoryUndo("warehouse-account", undo(102));
    assert.equal(store.pendingInventoryRecalls().length, 1);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
    await handler.flushInventoryRecalls();
    assert.equal(store.pendingInventoryRecalls().length, 0);
    assert.equal(store.isInventoryMessageRecalled(message("102")), true);
  });

  it("gắn đúng nguồn cho số thập phân có dấu phẩy và bỏ tin cũ đã thu hồi trong batch", () => {
    const old = message("103", "Nhận 300kg bò mỹ lát");
    const newer = message("104");
    const ctx = context([old, newer]);
    assert.equal(inventoryTool.findSourceMessageForInventoryItem({ tenHang: "bò mỹ lát", soLuong: 324.5 }, ctx).msgId, "104");
    store.recallInventoryMessage(old, new Date().toISOString());
    assert.equal(inventoryTool.findSourceMessageForInventoryItem({ tenHang: "bò mỹ lát", soLuong: 324.5 }, ctx).msgId, "104");
    assert.equal(inventoryTool.isItemInCurrentBatch({ tenHang: "bò mỹ lát", soLuong: 300 }, context([old])), false);
    assert.equal(inventoryTool.isItemInCurrentBatch({ tenHang: "bò mỹ lát", soLuong: 300 }, ctx), false);
  });

  it("tool gửi mã nguồn riêng của từng món, kể cả khi batch có nhiều tin", async () => {
    const posts: { items: Record<string, unknown>[] }[] = [];
    mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("products-catalog")) return Response.json({ success: true, products: [{ code: "BM", name: "bò mỹ lát", unit: "kg" }] });
      posts.push(JSON.parse(String(init?.body))); return Response.json({ success: true });
    });
    const result = await executeTool([message("105"), message("106", "Nhận 108kg heo xay")], [
      { tenHang: "bò mỹ lát", soLuong: 324.5, dvt: "kg" }, { tenHang: "heo xay", soLuong: 108, dvt: "kg" },
    ]);
    assert.equal(result.success, true);
    assert.deepEqual(posts[0]?.items.map((item) => [item.sourceMessageId, item.sourceAccountId]),
      [["105", "warehouse-account"], ["106", "warehouse-account"]]);
  });

  it("thu hồi trong lúc tool đang đợi mạng thì không gửi kết quả AI cũ", async () => {
    const msg = message("107");
    let postCount = 0;
    // Thu hồi khi lượt đang chờ tra danh mục, trước khi gửi yêu cầu ghi hàng.
    mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") postCount++;
      return Response.json({ success: true });
    });
    const pending = executeTool([msg], [{ tenHang: "bò mỹ lát", soLuong: 324.5 }]);
    store.recallInventoryMessage(msg, new Date().toISOString());
    await pending;
    assert.equal(postCount, 0);
  });

  it("đường dự phòng bỏ tin thu hồi, gửi mã nguồn tin mới và chỉ thả tim tin còn hiệu lực", async () => {
    const old = message("108");
    const newer = message("109");
    store.recallInventoryMessage(old, new Date().toISOString());
    const posts: { items: Record<string, unknown>[] }[] = [];
    const reacted: string[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body))); return Response.json({ success: true, count: 1 });
    });
    await safetyNet.runWarehouseSafetyNet(context([newer]).account,
      { tuThaCamXuc: (_config: unknown, msg: ParsedMessage) => reacted.push(msg.msgId) } as never, [old, newer]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.items[0]?.sourceMessageId, "109");
    assert.deepEqual(reacted, ["109"]);
  });

  it("gắn tin báo chen sau ảnh và gửi đủ ba dòng, đơn vị theo tin gốc", async () => {
    const image = message("201", "");
    const report = message("202", picklesReport);
    const posts: { items: Record<string, unknown>[] }[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ success: true, products: [] });
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return Response.json({ success: true, count: body.items.length });
    });
    const currentMessages = [image];
    const tool = inventoryTool.createRecordInventoryImportTool({
      ...context([image]), inventoryMessages: () => currentMessages,
    });
    currentMessages.push(report);
    const result = await (tool.execute as Function)({ nhanVien: "Tiền" }, { toolCallId: "test", messages: [] });
    assert.deepEqual(result.completeSourceMessageIds, ["202"]);
    assert.deepEqual(posts[0]?.items.map((item) => [item.rawItemName, item.quantity, item.unit, item.sourceMessageId]), [
      ["miến hàn", 300, "kg", "202"], ["bột ớt", 700, "kg", "202"], ["cải muối", 20, "thùng", "202"],
    ]);
  });

  it("một lần ghi thành công một món vẫn đối soát cả tin trước khi thả tim", async () => {
    const report = message("203", picklesReport);
    const posts: { items: Record<string, unknown>[] }[] = [];
    const reacted: string[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ success: true, products: [] });
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return Response.json({ success: true, count: body.items.length });
    });
    const result = await executeTool([report], [{ tenHang: "cải muối", soLuong: 20, dvt: "hộp" }]);
    assert.equal(result.success, true);
    assert.deepEqual(result.completeSourceMessageIds, []);
    assert.equal(posts[0]?.items[0]?.unit, "thùng");
    await safetyNet.runWarehouseSafetyNet(context([report]).account,
      { tuThaCamXuc: (_config: unknown, msg: ParsedMessage) => reacted.push(msg.msgId) } as never,
      [report, report], new Set(result.completeSourceMessageIds));
    assert.deepEqual(posts[1]?.items.map((item) => [item.rawItemName, item.unit]), [
      ["miến hàn", "kg"], ["bột ớt", "kg"], ["cải muối", "thùng"],
    ]);
    assert.deepEqual(reacted, ["203"]);
  });

  it("không thả tim khi Dashboard xác nhận lưu thiếu dòng", async () => {
    const report = message("204", picklesReport);
    const reacted: string[] = [];
    mock.method(globalThis, "fetch", async () => Response.json({ success: true, count: 2 }));
    await safetyNet.runWarehouseSafetyNet(context([report]).account,
      { tuThaCamXuc: (_config: unknown, msg: ParsedMessage) => reacted.push(msg.msgId) } as never, [report]);
    assert.deepEqual(reacted, []);
  });
});
