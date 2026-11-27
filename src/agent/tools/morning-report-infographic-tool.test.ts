import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import type { AgentProfile } from "../../config/agent-store.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import type { ScheduledAttachment } from "./tool-catalog-types.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";

let dataDir: string;
let infographicMod: typeof import("../../images/morning-report-infographic.js");
let toolMod: typeof import("./morning-report-infographic-tool.js");
let tempDir: string;

const SAMPLE_REPORT = {
  schemaVersion: 1,
  reportType: "morning-order-schedule",
  generatedAt: "2026-11-25T07:00:19.025293+07:00",
  status: "ok",
  summary:
    "📦 4 mã siết tồn — đơn theo lịch + gửi xe ngoài\n" +
    "🏭 Tổng kho YAGAMI:\n" +
    "• SML: cần 89 | tồn 266 | giữ 108 | khả dụng 158\n" +
    "• SMN: cần 36 | tồn 316 | giữ 76 | khả dụng 240\n" +
    "• SLTL: cần 49 | tồn 844 | giữ 161 | khả dụng 683\n" +
    "• MYG: cần 443 | tồn 1805 | giữ 558 | khả dụng 1247\n" +
    "🏭 KHO YAGAMI BÌNH DƯƠNG:\n" +
    "• SML: cần 29 | tồn 750 | giữ 35 | khả dụng 715\n" +
    "• SMN: cần 30 | tồn 651 | giữ 30 | khả dụng 621\n" +
    "• SLTL: cần 21 | tồn 448 | giữ 28 | khả dụng 420\n" +
    "• MYG: cần 164 | tồn 716 | giữ 194 | khả dụng 522\n" +
    "⚠️ Cần theo dõi:\n• 4 chi nhánh chưa đặt",
  metrics: {
    scheduledBranches: 34,
    orderedBranches: 30,
    missingBranches: 4,
    scheduledOrders: 38,
    scheduledRevenue: 1369888000,
    externalOrders: 7,
    externalRevenue: 84320000,
    otherScheduleOrders: 12,
    otherScheduleRevenue: 1011004000,
  },
  warehouses: [
    {
      name: "Tổng kho YAGAMI",
      scheduled: { branches: 23, orders: 30, revenue: 963405500, branchNames: ["LONG XUYÊN & MỚI", "CẦN ĐĂNG"] },
      missingBranches: [{ name: "GÒ QUAO" }],
      external: { branches: 5, orders: 7, revenue: 84320000 },
      otherSchedule: { orders: 10, revenue: 914116500 },
    },
    {
      name: "KHO YAGAMI BÌNH DƯƠNG",
      scheduled: { branches: 7, orders: 8, revenue: 406482500, branchNames: ["BẾN LỨC", "ĐỨC HÒA"] },
      missingBranches: [{ name: "ĐỊNH QUÁN" }],
      external: { branches: 0, orders: 0, revenue: 0 },
      otherSchedule: { orders: 2, revenue: 96887500 },
    },
  ],
  alerts: ["4 chi nhánh chưa đặt"],
};

function makeBaseContext(overrides: { isolated?: boolean; queue?: ScheduledAttachment[]; sentCalls?: unknown[] }) {
  const account = { id: "acc-test", disabledTools: [], loai: "ca_nhan" } as unknown as AccountConfig;
  const agent = { id: "agent-test", disabledTools: [] } as unknown as AgentProfile;
  const message = {
    threadId: "thread-test",
    threadType: ThreadType.Group,
    isGroup: true,
    text: "báo cáo sáng",
  } as unknown as ParsedMessage;

  const fakeApi = {
    sendMessage: async (payload: unknown) => {
      overrides.sentCalls?.push(payload);
      return { ok: true };
    },
  } as unknown as API;

  return {
    api: fakeApi,
    account,
    agent,
    message,
    batch: [message],
    isolated: overrides.isolated,
    queueScheduledAttachment: overrides.queue
      ? (item: ScheduledAttachment) => overrides.queue!.push(item)
      : undefined,
  };
}

before(async () => {
  dataDir = setupTestEnv();
  infographicMod = await import("../../images/morning-report-infographic.js");
  toolMod = await import("./morning-report-infographic-tool.js");
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "infographic-test-"));
});

after(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
  const db = await import("../../conversation/database.js");
  db.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("morning-report-infographic", () => {
  it("parse được bảng 4 mã siết tồn và render ra PNG hợp lệ", () => {
    const sections = infographicMod.parseStockWatchFromSummary(SAMPLE_REPORT.summary);
    assert.equal(sections.length, 2);
    assert.equal(sections[0]!.rows.length, 4);
    assert.equal(sections[0]!.rows[0]!.code, "SML");
    assert.equal(sections[0]!.rows[0]!.available, 158);

    const png = infographicMod.renderMorningReportPng(SAMPLE_REPORT);
    assert.ok(png.length > 5000, "PNG phải có dung lượng đáng kể");
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.equal(png[2], 0x4e);
    assert.equal(png[3], 0x47);
  });

  it("lượt Lịch hẹn (isolated:true): đẩy ảnh vào queueScheduledAttachment và không tự gửi", async () => {
    const jsonPath = path.join(tempDir, "morning-report.json");
    await fsp.writeFile(jsonPath, JSON.stringify(SAMPLE_REPORT), "utf-8");

    const queue: ScheduledAttachment[] = [];
    const sentCalls: unknown[] = [];
    const ctx = makeBaseContext({ isolated: true, queue, sentCalls });

    const t = toolMod.createMorningReportInfographicTool(ctx, { jsonPath });
    const res = await (t as any).execute({ caption: "Báo cáo sáng" }, {});

    assert.ok(ketQuaThanhCong(res));
    assert.equal(sentCalls.length, 0, "Lượt lịch hẹn không được tự gọi api.sendMessage");
    assert.equal(queue.length, 1, "Phải đẩy 1 ảnh vào queueScheduledAttachment");
    assert.ok(fs.existsSync(queue[0]!.filePath), "File PNG tạm phải tồn tại để scheduler gửi");
    await queue[0]!.cleanup?.();
    assert.equal(fs.existsSync(queue[0]!.filePath), false, "cleanup phải xóa sạch file tạm");
  });

  it("lượt chat thường (isolated:false): gửi thẳng qua api.sendMessage kèm attachments", async () => {
    const jsonPath = path.join(tempDir, "morning-report-chat.json");
    await fsp.writeFile(jsonPath, JSON.stringify(SAMPLE_REPORT), "utf-8");

    const sentCalls: any[] = [];
    const ctx = makeBaseContext({ isolated: false, sentCalls });

    const t = toolMod.createMorningReportInfographicTool(ctx, { jsonPath });
    const res = await (t as any).execute({ caption: "Gửi anh báo cáo" }, {});

    assert.ok(ketQuaThanhCong(res));
    assert.equal(sentCalls.length, 1);
    assert.ok(Array.isArray(sentCalls[0].attachments) && sentCalls[0].attachments.length === 1);
  });

  it("trả về ketQuaLoi khi file morning-report.json không tồn tại", async () => {
    const ctx = makeBaseContext({ isolated: true, queue: [] });
    const t = toolMod.createMorningReportInfographicTool(ctx, {
      jsonPath: path.join(tempDir, "missing.json"),
    });
    const res = await (t as any).execute({}, {});
    const err = loiCuaTool(res);
    assert.ok(err);
    assert.match(err, /Không thể đọc dữ liệu báo cáo sáng/);
  });
});
