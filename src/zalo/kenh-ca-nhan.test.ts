import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";
import type { API, ThreadType } from "zca-js";

let dataDir: string;
let kenhCaNhan: typeof import("./kenh-ca-nhan.js").kenhCaNhan;

before(async () => {
  dataDir = setupTestEnv();
  ({ kenhCaNhan } = await import("./kenh-ca-nhan.js"));
});

after(() => {
  try {
    cleanupTestEnv(dataDir);
  } catch {
    // Windows file lock
  }
});

function makeConfig(autoReact = true): AccountConfig {
  return {
    id: "test-acc",
    autoReactEnabled: autoReact,
    autoReactIcon: "heart",
    typingIndicatorEnabled: false,
    disabledTools: [],
    autoAcceptFriends: false,
    autoAcceptFriendDelayMinutes: 1,
    readOnly: false,
  } as unknown as AccountConfig;
}

function makeMessage(msgId: string, cliMsgId = "c1"): ParsedMessage {
  return {
    accountId: "test-acc",
    msgId,
    cliMsgId,
    threadId: "thread-123",
    threadType: 1 as ThreadType,
    isGroup: false,
    senderId: "user-1",
    senderName: "User 1",
    text: "Nội dung",
    images: [],
    isSelf: false,
    mentionsMe: false,
    sentAt: new Date().toISOString(),
  } as unknown as ParsedMessage;
}

describe("kenhCaNhan - tuThaCamXuc", () => {
  it("thả reaction cho TẤT CẢ các tin trong batch", async () => {
    const reactions: Array<{ icon: unknown; target: unknown }> = [];
    const fakeApi = {
      addReaction: async (icon: unknown, target: unknown) => {
        reactions.push({ icon, target });
        return {};
      },
    } as unknown as API;

    const kenh = kenhCaNhan(fakeApi);
    const m1 = makeMessage("msg-1", "cli-1");
    const m2 = makeMessage("msg-2", "cli-2");
    const m3 = makeMessage("msg-3", "cli-3");

    kenh.tuThaCamXuc!(makeConfig(true), [m1, m2, m3]);

    // Chờ async loop hoàn thành (3 items * 150ms delay = ~300ms)
    await new Promise((r) => setTimeout(r, 450));

    assert.equal(reactions.length, 3);
    assert.deepEqual(
      reactions.map((r) => (r.target as { data: { msgId: string } }).data.msgId),
      ["msg-1", "msg-2", "msg-3"],
    );
  });

  it("không thả reaction nếu autoReactEnabled = false", async () => {
    const reactions: Array<{ icon: unknown; target: unknown }> = [];
    const fakeApi = {
      addReaction: async (icon: unknown, target: unknown) => {
        reactions.push({ icon, target });
        return {};
      },
    } as unknown as API;

    const kenh = kenhCaNhan(fakeApi);
    kenh.tuThaCamXuc!(makeConfig(false), [makeMessage("msg-1")]);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(reactions.length, 0);
  });

  it("bỏ qua tin không có msgId", async () => {
    const reactions: Array<{ icon: unknown; target: unknown }> = [];
    const fakeApi = {
      addReaction: async (icon: unknown, target: unknown) => {
        reactions.push({ icon, target });
        return {};
      },
    } as unknown as API;

    const kenh = kenhCaNhan(fakeApi);
    const m1 = makeMessage("");
    const m2 = makeMessage("msg-valid");

    kenh.tuThaCamXuc!(makeConfig(true), [m1, m2]);
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(reactions.length, 1);
    assert.equal((reactions[0]!.target as { data: { msgId: string } }).data.msgId, "msg-valid");
  });
});
