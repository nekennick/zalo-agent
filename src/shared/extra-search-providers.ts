/**
 * Các nguồn tìm kiếm bổ trợ cho web_search: Wikipedia & arXiv.
 * Cả hai đều miễn phí 100%, không cần API key.
 */

const USER_AGENT = "ZaloAgent/0.3.1 (https://github.com/vuhai2002/zalo-agent; bot@zalo-agent.local)";

/** Tra cứu tóm tắt bách khoa toàn thư từ Wikipedia */
export async function searchWikipediaQuick(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ title: string; extract: string } | null> {
  try {
    const searchUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&utf8=&format=json&srlimit=1`;
    const searchRes = await fetchFn(searchUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      query?: { search?: { title: string }[] };
    };
    const topTitle = searchData.query?.search?.[0]?.title;
    if (!topTitle) return null;

    const summaryUrl = `https://vi.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
    const summaryRes = await fetchFn(summaryUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!summaryRes.ok) return null;
    const summaryData = (await summaryRes.json()) as { title?: string; extract?: string };
    if (!summaryData.extract?.trim()) return null;

    return {
      title: summaryData.title ?? topTitle,
      extract: summaryData.extract.trim(),
    };
  } catch {
    return null;
  }
}

/** Nhận diện truy vấn có khả năng cần tra cứu học thuật/paper khoa học */
export function isAcademicQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("arxiv") ||
    q.includes("paper") ||
    q.includes("bài báo khoa học") ||
    q.includes("nghiên cứu") ||
    q.includes("transformer") ||
    q.includes("llm") ||
    q.includes("deepseek") ||
    q.includes("thuật toán")
  );
}

/** Tra cứu công bố khoa học từ kho arXiv */
export async function searchArxivQuick(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ title: string; summary: string }[] | null> {
  try {
    const endpoint = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
      query,
    )}&start=0&max_results=2`;
    const res = await fetchFn(endpoint, {
      headers: { Accept: "application/atom+xml, application/xml" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    if (entryMatches.length === 0) return null;

    const items: { title: string; summary: string }[] = [];
    for (const match of entryMatches.slice(0, 2)) {
      const entryXml = match[1] ?? "";
      const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1]!.replace(/\s+/g, " ").trim(),
          summary: (summaryMatch?.[1] ?? "").replace(/\s+/g, " ").trim(),
        });
      }
    }
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}
