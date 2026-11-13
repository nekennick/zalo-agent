import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

let dataDir: string;
let createNotebookLmTool: typeof import("./notebooklm-tool.js").createNotebookLmTool;
let store: typeof import("../../notebooklm/notebooklm-store.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");
let laKetQuaLoi: typeof import("./tool-failure-result.js").laKetQuaLoi;

const CALL_OPTS = { toolCallId: "tc-1", messages: [] } as never;

before(async () => {
  dataDir = setupTestEnv();
  ({ createNotebookLmTool } = await import("./notebooklm-tool.js"));
  store = await import("../../notebooklm/notebooklm-store.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
  ({ laKetQuaLoi } = await import("./tool-failure-result.js"));
});

after(async () => {
  const { closeDatabase } = await import("../../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  store.resetNotebookLmStore();
  tuning.setTuning("NOTEBOOKLM_ALLOW_EVERYONE", null);
  tuning.setTuning("NOTEBOOKLM_MAX_PER_DAY", null);
});

function makeCtx(opts?: {
  senderId?: string;
  isSelf?: boolean;
  allowUserIds?: string[];
  handoffUserId?: string;
  sentNotes?: string[];
  sentAttachments?: string[];
}) {
  const sentAttachments = opts?.sentAttachments ?? [];
  const api = {
    sendMessage: async (payload: { attachments?: string[] }) => {
      if (payload.attachments) sentAttachments.push(...payload.attachments);
      return {};
    },
  } as unknown as API;

  return {
    api,
    account: {
      id: "acc-1",
      label: "Khoa Bot",
      enabled: true,
      loai: "ca_nhan" as const,
      coBotToken: false,
      agentId: "agent-1",
      allowlist: { mode: "all" as const, userIds: opts?.allowUserIds ?? ["owner-1"] },
      handoffNotifyUserId: opts?.handoffUserId,
      groupRequireMention: true,
      respondToGroups: true,
      groupPassiveListen: true,
      autoReactEnabled: false,
      autoReactIcon: "heart",
      typingIndicatorEnabled: false,
      disabledTools: [],
      autoAcceptFriends: false,
      autoAcceptFriendDelayMinutes: 1,
    },
    agent: fakeAgentProfile(),
    message: {
      threadId: "thread-100",
      threadType: 0,
      senderId: opts?.senderId ?? "owner-1",
      isSelf: opts?.isSelf ?? false,
    } as never,
    batch: [],
    ghiNhanDaGui: (note: string) => opts?.sentNotes?.push(note),
  };
}

describe("notebooklm tool (14.4)", () => {
  it("mặc định chặn người lạ khi NOTEBOOKLM_ALLOW_EVERYONE = false", async () => {
    const ctx = makeCtx({ senderId: "stranger-99", allowUserIds: ["owner-1"] });
    const tool = createNotebookLmTool(ctx, { baseUrl: "http://nblm.test:3000" });
    const res = await tool.execute!({ action: "list_sources" }, CALL_OPTS);
    assert.ok(laKetQuaLoi(res));
    assert.match(res.loi, /chỉ cho phép chủ bot/i);
  });

  it("mở cho người lạ khi bật NOTEBOOKLM_ALLOW_EVERYONE = true", async () => {
    tuning.setTuning("NOTEBOOKLM_ALLOW_EVERYONE", true);
    const ctx = makeCtx({ senderId: "stranger-99", allowUserIds: ["owner-1"] });
    const tool = createNotebookLmTool(ctx, { baseUrl: "http://nblm.test:3000" });
    const res = await tool.execute!({ action: "list_sources" }, CALL_OPTS);
    assert.equal(typeof res, "string");
    assert.match(res as string, /chưa có sổ tay NotebookLM/i);
  });

  it("tự tạo sổ tay riêng ở lần add_source đầu tiên và tái sử dụng khi ask", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/notebooks/create")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              notebook_id: "nb-100",
              notebook_url: "https://notebooklm.google.com/notebook/nb-100",
              actual_name: "Zalo - acc-1 - thread-100",
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/content/sources")) {
        return new Response(
          JSON.stringify({ success: true, data: { title: "Quy trình xuất kho" } }),
          { status: 200 },
        );
      }
      if (url.endsWith("/ask")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              status: "completed",
              answer: "Xuất hàng gồm 3 bước [1].",
              sources: {
                citations: [
                  { marker: "[1]", number: 1, sourceName: "Quy trình xuất kho", sourceText: "Bước 1, 2, 3" },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const ctx = makeCtx();
    const tool = createNotebookLmTool(ctx, { baseUrl: "http://nblm.test:3000", fetchFn });
    const r1 = await tool.execute!(
      { action: "add_source", sourceType: "url", url: "https://example.com/doc" },
      CALL_OPTS,
    );
    assert.equal(typeof r1, "string");
    assert.match(r1 as string, /Đã nạp nguồn/);

    const r2 = await tool.execute!(
      { action: "ask", question: "Quy trình xuất hàng có mấy bước?" },
      CALL_OPTS,
    );
    assert.equal(typeof r2, "string");
    assert.match(r2 as string, /Xuất hàng gồm 3 bước/);
    assert.match(r2 as string, /\[1\] \[Quy trình xuất kho\] Bước 1, 2, 3/);
    assert.equal(calls.filter((u) => u.endsWith("/notebooks/create")).length, 1);
  });

  it("chặn khi chạm trần NOTEBOOKLM_MAX_PER_DAY và hoàn suất nếu API lỗi", async () => {
    tuning.setTuning("NOTEBOOKLM_MAX_PER_DAY", 1);
    const ctx = makeCtx();
    const failTool = createNotebookLmTool(ctx, {
      baseUrl: "http://nblm.test:3000",
      fetchFn: async () => new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }),
    });
    const failed = await failTool.execute!(
      { action: "add_source", sourceType: "text", text: "Nội dung A" },
      CALL_OPTS,
    );
    assert.ok(laKetQuaLoi(failed));

    const okTool = createNotebookLmTool(ctx, { baseUrl: "http://nblm.test:3000" });
    const okRes = await okTool.execute!({ action: "list_sources" }, CALL_OPTS);
    assert.equal(typeof okRes, "string");

    const overRes = await okTool.execute!({ action: "list_sources" }, CALL_OPTS);
    assert.ok(laKetQuaLoi(overRes));
    assert.match(overRes.loi, /đã dùng hết trần 1 lượt/i);
  });

  it("generate_audio đổi file .m4a sang .mp3 qua ffmpegRunner rồi gửi file lên Zalo", async () => {
    store.saveThreadNotebook({
      accountId: "acc-1",
      threadId: "thread-100",
      notebookId: "nb-audio",
      notebookUrl: "https://notebooklm.google.com/notebook/nb-audio",
      title: "Sổ tay Audio",
    });
    const nblmDir = path.join(dataDir, "notebooklm");
    fs.mkdirSync(nblmDir, { recursive: true });
    fs.writeFileSync(path.join(nblmDir, "overview-test.m4a"), Buffer.from("FAKE_M4A_DATA"));

    let ffmpegCalled = false;
    const ffmpegRunner = async (_inPath: string, outPath: string) => {
      ffmpegCalled = true;
      await fs.promises.writeFile(outPath, Buffer.from("FAKE_MP3_CONVERTED_CONTENT"));
    };
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/content/generate")) {
        return new Response(JSON.stringify({ success: true, data: { status: "completed" } }), { status: 200 });
      }
      if (url.includes("/content/download")) {
        return new Response(
          JSON.stringify({ success: true, data: { filePath: "/data/notebooklm/overview-test.m4a" } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const sentNotes: string[] = [];
    const sentAttachments: string[] = [];
    const ctx = makeCtx({ sentNotes, sentAttachments });
    const tool = createNotebookLmTool(ctx, { baseUrl: "http://nblm.test:3000", fetchFn, ffmpegRunner });
    const res = await tool.execute!(
      { action: "generate_audio", caption: "Podcast tóm tắt tài liệu" },
      CALL_OPTS,
    );
    assert.equal(typeof res, "string");
    assert.ok(ffmpegCalled, "phải gọi ffmpegRunner để đổi .m4a sang .mp3");
    assert.equal(sentAttachments.length, 1);
    assert.match(sentAttachments[0]!, /\.mp3$/);
    assert.equal(sentNotes.length, 1);
  });
});
