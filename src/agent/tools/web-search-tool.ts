import { tool } from "ai";
import { z } from "zod";
import { getSearchSettings } from "../../config/runtime-tool-settings.js";
import { searchWeb } from "../../shared/web-search-providers.js";
import { isAcademicQuery, searchArxivQuick, searchWikipediaQuick } from "../../shared/extra-search-providers.js";
import { locKyTuAn } from "./tag-ky-tu-an.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";

/**
 * Tìm kiếm web đa nguồn cho agent: DuckDuckGo / Brave, tích hợp bách khoa
 * toàn thư Wikipedia và học thuật arXiv khi được kích hoạt.
 *
 * Người dùng yêu cầu không trích dẫn nguồn nên câu trả lời cuối cùng không
 * chèn link URL.
 */
export function createWebSearchTool() {
  return tool({
    description:
      "Tìm kiếm thông tin trên web (tin tức, sự kiện, giá cả, bách khoa toàn thư, học thuật). " +
      "Dùng thông tin tra được để trả lời người dùng tự nhiên, rõ ràng. " +
      "LƯU Ý: KHÔNG trích dẫn nguồn hay chèn link (URL) vào câu trả lời trừ khi người dùng chủ động yêu cầu.",
    inputSchema: z.object({
      query: z.string().min(1).max(400).describe("Từ khóa tìm kiếm, giữ ngắn gọn"),
    }),
    execute: async ({ query }) => {
      const settings = getSearchSettings();

      // Gọi đồng thời web search cùng các nguồn bổ trợ được bật
      const [webResults, wikiResult, arxivResults] = await Promise.all([
        searchWeb(query, {
          maxResults: getTuning("WEB_SEARCH_MAX_RESULTS"),
          braveApiKey: settings.provider === "brave" ? settings.braveApiKey : undefined,
        }),
        settings.wikipediaEnabled ? searchWikipediaQuick(query) : Promise.resolve(null),
        settings.arxivEnabled && isAcademicQuery(query) ? searchArxivQuick(query) : Promise.resolve(null),
      ]);

      const lines: string[] = [];

      // Nguồn bách khoa Wikipedia nếu tìm thấy
      if (wikiResult) {
        lines.push(`[Bách khoa Wikipedia - ${wikiResult.title}]`);
        lines.push(wikiResult.extract);
        lines.push("");
      }

      // Nguồn học thuật arXiv nếu tìm thấy
      if (arxivResults && arxivResults.length > 0) {
        lines.push("[Công bố học thuật arXiv]");
        for (const p of arxivResults) {
          lines.push(`- ${p.title}: ${p.summary.slice(0, 300)}...`);
        }
        lines.push("");
      }

      // Nguồn web chung
      if (webResults.length > 0) {
        lines.push("[Kết quả tìm kiếm web]");
        webResults.forEach((r, i) => {
          lines.push(`${i + 1}. ${r.title}${r.snippet ? `: ${r.snippet}` : ""}`);
        });
      }

      if (lines.length === 0) {
        return ketQuaLoi(
          "Không tìm thấy kết quả nào (hoặc dịch vụ tìm kiếm đang lỗi). Thử từ khóa khác.",
        );
      }

      lines.push("");
      lines.push("HƯỚNG DẪN TRẢ LỜI: Trả lời thông tin trực tiếp, tự nhiên. KHÔNG đính kèm link/URL hay nguồn bài viết vào câu trả lời gửi cho người dùng.");

      return wrapUntrustedContent(locKyTuAn(lines.join("\n")), `kết quả tìm kiếm: ${query}`);
    },
  });
}
