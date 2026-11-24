import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import type { ToolContext } from "./index.js";

let dataDir: string;
let vietQrTools: typeof import("./vietqr-tools.js");
let lookupReceiverTool: typeof import("./lookup-receiver-tool.js");
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../../conversation/database.js");
  vietQrTools = await import("./vietqr-tools.js");
  lookupReceiverTool = await import("./lookup-receiver-tool.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGuiTin: unknown[] = [];

beforeEach(() => {
  daGuiTin = [];
});

const fakeApi = {
  sendMessage: async (payload: unknown) => {
    daGuiTin.push(payload);
    return { messageId: "123" };
  },
} as any;

const makeCtx = (): ToolContext => ({
  api: fakeApi,
  account: {
    id: "acc-1",
    label: "Bot",
    enabled: true,
    agentId: "default",
    allowlist: { mode: "all", userIds: [] },
    groupRequireMention: false,
    respondToGroups: true,
    groupPassiveListen: false,
    autoReactEnabled: false,
    autoReactIcon: "heart",
    typingIndicatorEnabled: false,
    disabledTools: [],
    autoAcceptFriends: false,
    autoAcceptFriendDelayMinutes: 1,
    readOnly: false,
    handoffNotifyUserId: "",
    loai: "ca_nhan",
    botTokenEnc: "",
    coBotToken: false,
  } as unknown as AccountConfig,
  agent: {
    id: "default",
    name: "Agent",
    icon: "🤖",
    persona: "",
    isDefault: true,
    disabledTools: [],
  } as any,
  message: {
    id: "msg-1",
    accountId: "acc-1",
    threadId: "g-1",
    threadType: ThreadType.Group,
    isGroup: true,
    senderId: "u-1",
    senderName: "Trần Anh Khoa",
    text: "@bot mã qr của mình",
    images: [],
    mentionsMe: true,
    sentAt: new Date().toISOString(),
  } as unknown as ParsedMessage,
  batch: [],
  ghiNhanDaGui: () => {},
});

const mockOptions = { toolCallId: "1", messages: [] } as any;

describe("vietqr-tools", () => {
  it("lookup_payment_receiver tìm thấy tài khoản đã lưu", async () => {
    const tool = lookupReceiverTool.createLookupReceiverTool();
    const result = await tool.execute({ receiver_name: "Chị Dung" }, mockOptions) as any;

    assert.equal(result.found, true);
    assert.equal(result.account.accountNumber, "107001620872");
    assert.equal(result.account.accountHolder, "PHAN THANH DUNG");
  });

  it("lookup_payment_receiver báo chưa có khi tra người lạ", async () => {
    const tool = lookupReceiverTool.createLookupReceiverTool();
    const result = await tool.execute({ receiver_name: "Anh Tuấn Lạ Mặt" }, mockOptions) as any;

    assert.equal(result.found, false);
    assert.match(result.message, /Chưa có thông tin số tài khoản/);
  });

  it("send_payment_qr tạo và gửi ảnh mã VietQR", async () => {
    const ctx = makeCtx();
    const tool = vietQrTools.createSendPaymentQrTool(ctx);

    const result = await tool.execute(
      {
        receiver_name: "Dung",
        amount: 55000,
        memo: "Khoa tra tien bun bo",
        caption: "@Trần Anh Khoa mã thanh toán 55.000đ",
      },
      mockOptions,
    );

    assert.match(String(result), /thành công/);
    assert.equal(daGuiTin.length, 1);
  });
});
