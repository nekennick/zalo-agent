import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type API, type Mention, type Style, type ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ReplyTarget } from "./send-reply-in-parts.js";

let dataDir: string;
let sender: typeof import("./send-reply-in-parts.js");
let deliver: typeof import("./deliver-chat-reply.js");

before(async () => {
  dataDir = setupTestEnv();
  sender = await import("./send-reply-in-parts.js");
  deliver = await import("./deliver-chat-reply.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

type LanGui = { msg: string; styles?: Style[]; mentions?: Mention[]; khoa: string[] };
let daGui: LanGui[] = [];
beforeEach(() => {
  daGui = [];
});

function loiMayChu(code: number): Error {
  return Object.assign(new Error("Lỗi không xác định"), { code });
}

function taoMuc(
  mentions: Mention[] | undefined,
  mentionMember?: { uid: string; name: string },
  tuChoi: (lan: number, co: LanGui) => void = () => {},
) {
  const api = {
    sendMessage: async (payload: { msg: string; styles?: Style[]; mentions?: Mention[] }) => {
      const ghi: LanGui = { ...payload, khoa: Object.keys(payload) };
      daGui.push(ghi);
      tuChoi(daGui.length, ghi);
      return { msgId: `m-${daGui.length}` };
    },
  } as unknown as API;

  const target: ReplyTarget = {
    guiMotDoan: sender.duongGuiZcaJs(api, "thread1", 1 as ThreadType),
    threadKey: "acc:thread1",
    threadId: "thread1",
    threadType: 1 as ThreadType,
    mentions,
    mentionMember,
  };
  return target;
}

const MENTION_MAU: Mention[] = [{ pos: 0, uid: "user_1", len: 5 }];

describe("sendReplyInParts - đính mention", () => {
  it("câu trả lời một đoạn: mentions đi kèm", async () => {
    await sender.sendReplyInParts(taoMuc(undefined), "@Khoa Chào bạn", [], MENTION_MAU);

    assert.equal(daGui.length, 1);
    assert.deepEqual(daGui[0]!.mentions, MENTION_MAU);
    assert.ok(daGui[0]!.khoa.includes("mentions"));
  });

  it("không có mentions thì KHÔNG đính trường mentions", async () => {
    await sender.sendReplyInParts(taoMuc(undefined), "Chào bạn");

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0]!.mentions, undefined);
    assert.ok(!daGui[0]!.khoa.includes("mentions"));
  });

  it("câu trả lời bị cắt nhiều đoạn: CHỈ đoạn đầu có mentions", async () => {
    const dai = "Câu trả lời rất dài dòng và chi tiết. ".repeat(250);
    await sender.sendReplyInParts(taoMuc(undefined), `@Khoa ${dai}`, [], MENTION_MAU);

    assert.ok(daGui.length >= 2, `phải cắt nhiều đoạn, đang có ${daGui.length}`);
    assert.deepEqual(daGui[0]!.mentions, MENTION_MAU, "đoạn đầu phải có mentions");
    for (let i = 1; i < daGui.length; i++) {
      assert.ok(!daGui[i]!.khoa.includes("mentions"), `đoạn ${i + 1} không được đính mentions`);
    }
  });

  it("đường lui khi Zalo từ chối tin có mention: gửi lại dạng chữ trơn không mention", async () => {
    const muc = taoMuc(undefined, undefined, (lan, co) => {
      if (lan === 1 && co.mentions) throw loiMayChu(112);
    });

    const ket = await sender.sendReplyInParts(muc, "@Khoa Chào bạn", [], MENTION_MAU);

    assert.equal(ket.error, undefined);
    assert.equal(daGui.length, 2, "gửi lại lần hai");
    assert.ok(!daGui[1]!.khoa.includes("mentions"), "lần hai bỏ mentions");
    assert.equal(daGui[1]!.msg, "@Khoa Chào bạn", "nội dung chữ vẫn nguyên vẹn");
  });
});

describe("deliverChatReply - tích hợp tự động tag mention trong nhóm", () => {
  it("tự động gắn tag @Tên khi target có mentionMember", async () => {
    const target = taoMuc(undefined, { uid: "user_99", name: "Thành Đạt" });

    const ket = await deliver.deliverChatReply(target, "acc1", "thread1", "Dạ em đã kiểm tra xong rồi ạ.");

    assert.equal(ket.hong, false);
    assert.equal(daGui.length, 1);
    assert.equal(daGui[0]!.msg, "@Thành Đạt Dạ em đã kiểm tra xong rồi ạ.");
    assert.deepEqual(daGui[0]!.mentions, [
      { pos: 0, uid: "user_99", len: 10 }, // "@Thành Đạt".length = 10
    ]);
  });
});
