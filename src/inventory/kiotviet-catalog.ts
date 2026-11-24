import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../shared/logger.js";

const log = createLogger("inventory:kiotviet-catalog");

export type KiotVietProduct = {
  code: string;
  name: string;
  unit: string;
  category?: string;
  price?: number;
};

export type LookupResult = {
  product: KiotVietProduct | null;
  ambiguous?: boolean;
  candidates?: KiotVietProduct[];
  suggestedQuestion?: string;
};

// Địa chỉ API Dashboard nội bộ
const DASHBOARD_CATALOG_URL =
  process.env.YAGAMI_DASHBOARD_CATALOG_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://host.docker.internal:3000/api/internal/products-catalog"
    : "http://127.0.0.1:3000/api/internal/products-catalog");

const FALLBACK_CACHE_FILE = path.resolve("./data/kiotviet-catalog-cache.json");

let catalogCache: KiotVietProduct[] = [];
let lastSyncTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // Cache 10 phút

/**
 * Xóa dấu tiếng Việt, chuyển chữ thường và chuẩn hóa khoảng trắng để tìm kiếm
 */
export function normalizeVietnamese(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Đồng bộ danh mục hàng hóa từ Yagami Dashboard (Single Source of Truth)
 */
export async function syncKiotVietCatalog(force = false): Promise<KiotVietProduct[]> {
  const now = Date.now();
  if (!force && catalogCache.length > 0 && now - lastSyncTime < CACHE_TTL_MS) {
    return catalogCache;
  }

  // Thử tải từ Yagami Dashboard
  try {
    log.info({ url: DASHBOARD_CATALOG_URL }, "Tải danh mục sản phẩm từ Yagami Dashboard...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(DASHBOARD_CATALOG_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "ZaloAgent-Catalog/1.0" },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { success: boolean; products?: any[] };
      if (data.success && Array.isArray(data.products) && data.products.length > 0) {
        const products: KiotVietProduct[] = data.products.map((p) => ({
          code: String(p.code || "").trim(),
          name: String(p.name || "").trim(),
          unit: String(p.unit || "").trim(),
          category: String(p.categoryName || "").trim(),
          price: Number(p.basePrice || 0),
        }));

        catalogCache = products;
        lastSyncTime = now;
        log.info({ count: products.length }, "Đã đồng bộ danh mục KiotViet từ Dashboard thành công");

        // Lưu bản đệm offline
        try {
          fs.mkdirSync(path.dirname(FALLBACK_CACHE_FILE), { recursive: true });
          fs.writeFileSync(FALLBACK_CACHE_FILE, JSON.stringify(products, null, 2), "utf8");
        } catch {}

        return catalogCache;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "Không kết nối được Dashboard API, chuyển sang nạp bản đệm cục bộ");
  }

  // Fallback 1: Thử đọc từ bản đệm cục bộ trên đĩa
  if (catalogCache.length === 0 && fs.existsSync(FALLBACK_CACHE_FILE)) {
    try {
      const localData = JSON.parse(fs.readFileSync(FALLBACK_CACHE_FILE, "utf8"));
      if (Array.isArray(localData) && localData.length > 0) {
        catalogCache = localData;
        lastSyncTime = now;
        log.info({ count: localData.length }, "Đã nạp danh mục KiotViet từ file đệm cục bộ");
        return catalogCache;
      }
    } catch {}
  }

  return catalogCache;
}

/**
 * Tính điểm khớp giữa sản phẩm và query
 */
function calculateMatchScore(
  product: KiotVietProduct,
  query: string,
  contextProducts: KiotVietProduct[] = [],
): number {
  const normQuery = normalizeVietnamese(query);
  const normName = normalizeVietnamese(product.name);
  const rawQuery = query.trim().toUpperCase();
  const rawCode = product.code.toUpperCase();

  // 1. Khớp chính xác mã hàng
  if (rawCode === rawQuery) return 1000;

  // 2. Khớp chính xác tên hàng
  if (normName === normQuery) return 900;

  let score = 0;

  // 3. Tên BẮT ĐẦU bằng cụm từ tìm kiếm (vd "nap ly" -> "Nắp Ly Mang Về")
  if (normName.startsWith(`${normQuery} `)) {
    score += 500;
  } else if (` ${normName} `.includes(` ${normQuery} `)) {
    // Tên chứa nguyên vẹn cụm từ tìm kiếm
    score += 300;
  } else {
    // Các từ khóa nằm rải rác
    const queryTokens = normQuery.split(" ").filter(Boolean);
    const nameTokens = new Set(normName.split(" "));
    const allTokensPresent = queryTokens.every((token) => nameTokens.has(token));
    if (allTokensPresent) {
      score += 150;
    }
  }

  if (!score) return 0;

  if (contextProducts.some((cp) => product.category && cp.category === product.category)) score += 25;
  const paired = contextProducts.some((cp) => {
    const normCp = normalizeVietnamese(cp.name);
    return (normCp.startsWith("nap ly") && normName.startsWith("ly mang ve"))
      || (normCp.startsWith("ly mang ve") && normName.startsWith("nap ly"));
  });
  if (paired) score += 150;

  // Phạt điểm nếu query là "nắp ly" mà tên sản phẩm lại là "Ly Quai Nắp Thiết" (từ chính là ly chứ không phải nắp)
  if (normQuery.startsWith("nap") && !normName.startsWith("nap")) {
    score -= 200;
  }
  if (normQuery.startsWith("ly") && normName.startsWith("nap")) {
    // Query tìm "ly" mà tên là "nắp ly" thì trừ điểm
    score -= 200;
  }

  return score;
}

/**
 * Tra cứu sản phẩm trong danh mục KiotViet có xét đến ngữ cảnh các món đi kèm trong cùng tin nhắn
 */
export async function lookupKiotVietProduct(
  query: string,
  contextProducts: KiotVietProduct[] = [],
  reportedUnit?: string,
): Promise<LookupResult> {
  const catalog = await syncKiotVietCatalog();
  return rankKiotVietProducts(catalog, query, contextProducts, reportedUnit);
}

export function rankKiotVietProducts(
  catalog: KiotVietProduct[], query: string, contextProducts: KiotVietProduct[] = [], reportedUnit?: string,
): LookupResult {
  if (!normalizeVietnamese(query)) return { product: null };
  const unit = normalizeVietnamese(reportedUnit || "");
  const scored = catalog
    .map((p) => ({
      product: p,
      score: calculateMatchScore(p, query, contextProducts),
      compatible: !unit || normalizeVietnamese(p.unit) === unit,
    }))
    .filter((item) => item.product.code && item.score > 0)
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.score - a.score);

  if (scored.length === 0) {
    return { product: null };
  }

  const [best, second] = scored;
  if (best.compatible && best.score >= 500 && (!second?.compatible || best.score - second.score >= 150)) {
    return { product: best.product };
  }

  // Nếu có nhiều món điểm ngang nhau -> Mơ hồ, cần hỏi lại người dùng
  const topCandidates = scored.slice(0, 4).map((s) => s.product);
  const firstCandidate = topCandidates[0];
  const suggestedQuestion = `Dạ trong danh mục KiotViet có các loại liên quan: ${topCandidates.map((c) => `[${c.code}] ${c.name}`).join(", ")}. Có phải anh/chị đang nhận [${firstCandidate.code}] ${firstCandidate.name} không ạ?`;

  return {
    product: null,
    ambiguous: true,
    candidates: topCandidates,
    suggestedQuestion,
  };
}
