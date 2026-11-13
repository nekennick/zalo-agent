import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAcademicQuery, searchArxivQuick, searchWikipediaQuick } from "./extra-search-providers.js";

describe("extra-search-providers", () => {
  it("isAcademicQuery nhận diện đúng câu hỏi học thuật", () => {
    assert.equal(isAcademicQuery("tìm paper về attention is all you need"), true);
    assert.equal(isAcademicQuery("mô hình transformer hoạt động thế nào"), true);
    assert.equal(isAcademicQuery("thời tiết hôm nay ở hà nội"), false);
  });

  it("searchWikipediaQuick trả về tóm tắt khi tìm thấy", async () => {
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("action=query")) {
        return new Response(JSON.stringify({ query: { search: [{ title: "Trí tuệ nhân tạo" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ title: "Trí tuệ nhân tạo", extract: "Tóm tắt về AI..." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await searchWikipediaQuick("Trí tuệ nhân tạo", mockFetch);
    assert.ok(res);
    assert.equal(res.title, "Trí tuệ nhân tạo");
    assert.equal(res.extract, "Tóm tắt về AI...");
  });

  it("searchArxivQuick trả về danh sách paper khi parse XML", async () => {
    const xml = `<feed><entry><title>Deep Learning Paper</title><summary>Abstract here</summary></entry></feed>`;
    const mockFetch: typeof fetch = async () =>
      new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } });

    const res = await searchArxivQuick("deep learning", mockFetch);
    assert.ok(res);
    assert.equal(res.length, 1);
    assert.equal(res[0]?.title, "Deep Learning Paper");
  });
});
