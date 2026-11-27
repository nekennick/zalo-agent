import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

export type MorningReportMissingBranch = {
  code?: string;
  name: string;
};

export type MorningReportWarehouse = {
  name: string;
  scheduled?: {
    branches: number;
    orders: number;
    revenue: number;
    branchNames?: string[];
  };
  missingBranches?: MorningReportMissingBranch[];
  external?: {
    branches: number;
    orders: number;
    revenue: number;
  };
  otherSchedule?: {
    orders: number;
    revenue: number;
  };
};

export type MorningReportJson = {
  schemaVersion?: number;
  reportType?: string;
  generatedAt?: string;
  timezone?: string;
  status?: "ok" | "error" | string;
  summary?: string;
  error?: string;
  dataFreshness?: {
    ordersAsOf?: string;
    inventorySyncedAt?: string;
  };
  metrics?: {
    scheduledBranches?: number;
    orderedBranches?: number;
    missingBranches?: number;
    scheduledOrders?: number;
    scheduledRevenue?: number;
    externalOrders?: number;
    externalRevenue?: number;
    otherScheduleOrders?: number;
    otherScheduleRevenue?: number;
    stockWarningCount?: number;
  };
  warehouses?: MorningReportWarehouse[];
  alerts?: string[];
};

export type StockWatchRow = {
  code: string;
  needed: number;
  stock: number;
  reserved: number;
  available: number;
  note?: string;
};

export type WarehouseStockSection = {
  warehouseName: string;
  rows: StockWatchRow[];
};

const WIDTH = 1080;
const PADDING_X = 40;
const INNER_W = WIDTH - PADDING_X * 2;
const FONT_FAMILY = "Be Vietnam Pro";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatVnd(amount: number | undefined): string {
  const value = Math.round(amount ?? 0);
  return `${value.toLocaleString("vi-VN")}đ`;
}

function formatShortDate(iso?: string): { dateLabel: string; timeLabel: string } {
  const dt = iso ? new Date(iso) : new Date();
  if (Number.isNaN(dt.getTime())) {
    return { dateLabel: "Hôm nay", timeLabel: "07:00" };
  }
  const weekday = dt.toLocaleDateString("vi-VN", { weekday: "long", timeZone: "Asia/Ho_Chi_Minh" });
  const datePart = dt.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const timePart = dt.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const capWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return { dateLabel: `${capWeekday}, ${datePart}`, timeLabel: timePart };
}

/**
 * Trích xuất bảng 4 mã siết tồn (SML, SMN, SLTL, MYG) theo từng kho từ `summary`
 * vì `morning-report.json` hiện chỉ lưu `stockWarnings` (khi có thiếu) mà chưa tách
 * trường JSON riêng cho từng mã.
 */
export function parseStockWatchFromSummary(summary: string | undefined): WarehouseStockSection[] {
  if (!summary) return [];
  const lines = summary.split(/\r?\n/);
  const sections: WarehouseStockSection[] = [];
  let inStockBlock = false;
  let current: WarehouseStockSection | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.includes("4 mã siết tồn")) {
      inStockBlock = true;
      continue;
    }
    if (!inStockBlock) continue;
    if (line.startsWith("⚠️") || line.startsWith("Cần theo dõi")) break;

    if (line.startsWith("🏭")) {
      const name = line.replace(/^🏭\s*/, "").replace(/:$/, "").trim();
      current = { warehouseName: name, rows: [] };
      sections.push(current);
      continue;
    }

    const match = line.match(
      /^[•\-*]?\s*(SML|SMN|SLTL|MYG)\s*:\s*cần\s+(-?\d+)\s*\|\s*tồn\s+(-?\d+)\s*\|\s*giữ\s+(-?\d+)\s*\|\s*khả dụng\s+(-?\d+)(.*)$/i,
    );
    if (match && current) {
      current.rows.push({
        code: match[1]!.toUpperCase(),
        needed: Number(match[2]),
        stock: Number(match[3]),
        reserved: Number(match[4]),
        available: Number(match[5]),
        note: match[6]?.trim() || undefined,
      });
    }
  }

  return sections;
}

/** Chia danh sách tên thành các dòng vừa khít chiều rộng tối đa (ước lượng theo ký tự). */
function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Không có"];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapCommaList(items: string[], maxCharsPerLine: number): string[] {
  if (items.length === 0) return ["Không có"];
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < items.length; i++) {
    const token = i < items.length - 1 ? `${items[i]},` : items[i]!;
    const next = current ? `${current} ${token}` : token;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = token;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function resolveFontFiles(): string[] {
  const candidates = [
    path.resolve(process.cwd(), "assets/fonts/BeVietnamPro-Regular.ttf"),
    path.resolve(process.cwd(), "assets/fonts/BeVietnamPro-Bold.ttf"),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

export function buildMorningReportSvg(report: MorningReportJson): string {
  const metrics = report.metrics ?? {};
  const warehouses = report.warehouses ?? [];
  const stockSections = parseStockWatchFromSummary(report.summary);
  const { dateLabel, timeLabel } = formatShortDate(
    report.dataFreshness?.ordersAsOf ?? report.generatedAt,
  );
  const isOk = report.status !== "error";

  const svgParts: string[] = [];
  let y = 0;

  // 1. HEADER BANNER (height 148)
  const headerH = 148;
  svgParts.push(`
    <rect x="0" y="0" width="${WIDTH}" height="${headerH}" fill="#0F172A" />
    <rect x="0" y="${headerH - 5}" width="${WIDTH}" height="5" fill="#F59E0B" />
    <rect x="${PADDING_X}" y="30" width="6" height="84" rx="3" fill="#F59E0B" />
    <text x="${PADDING_X + 22}" y="62" font-family="${FONT_FAMILY}" font-size="34" font-weight="700" fill="#FFFFFF">BÁO CÁO ĐÓNG HÀNG SÁNG</text>
    <text x="${PADDING_X + 22}" y="98" font-family="${FONT_FAMILY}" font-size="18" font-weight="400" fill="#CBD5E1">${escapeXml(dateLabel)}  •  Chốt số liệu lúc ${escapeXml(timeLabel)} (KiotViet)</text>
    <rect x="${WIDTH - PADDING_X - 180}" y="42" width="180" height="38" rx="19" fill="${isOk ? "#065F46" : "#991B1B"}" />
    <text x="${WIDTH - PADDING_X - 90}" y="67" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#FFFFFF">${isOk ? "ĐÃ ĐỒNG BỘ" : "LỖI DỮ LIỆU"}</text>
  `);
  y = headerH + 26;

  // 2. KPI SUMMARY CARDS (5 cột)
  const cardGap = 14;
  const cardW = (INNER_W - cardGap * 4) / 5;
  const cardH = 108;
  const missingCount = metrics.missingBranches ?? 0;
  const kpis = [
    {
      title: "LỊCH HÔM NAY",
      value: `${metrics.orderedBranches ?? 0}/${metrics.scheduledBranches ?? 0} CN`,
      sub: `Đã đặt: ${metrics.orderedBranches ?? 0} chi nhánh`,
      accent: "#2563EB",
      bg: "#FFFFFF",
      stroke: "#E2E8F0",
      valueColor: "#0F172A",
      subColor: "#2563EB",
    },
    {
      title: "CHƯA ĐẶT HÀNG",
      value: `${missingCount} CN`,
      sub: missingCount > 0 ? "Cần nhắc đặt đơn" : "Đã đặt đủ 100%",
      accent: missingCount > 0 ? "#DC2626" : "#059669",
      bg: missingCount > 0 ? "#FEF2F2" : "#F0FDF4",
      stroke: missingCount > 0 ? "#FECACA" : "#BBF7D0",
      valueColor: missingCount > 0 ? "#B91C1C" : "#047857",
      subColor: missingCount > 0 ? "#DC2626" : "#059669",
    },
    {
      title: "ĐƠN THEO LỊCH",
      value: `${metrics.scheduledOrders ?? 0} phiếu`,
      sub: formatVnd(metrics.scheduledRevenue),
      accent: "#059669",
      bg: "#FFFFFF",
      stroke: "#E2E8F0",
      valueColor: "#0F172A",
      subColor: "#065F46",
    },
    {
      title: "GỬI XE NGOÀI",
      value: `${metrics.externalOrders ?? 0} phiếu`,
      sub: formatVnd(metrics.externalRevenue),
      accent: "#7C3AED",
      bg: "#FFFFFF",
      stroke: "#E2E8F0",
      valueColor: "#0F172A",
      subColor: "#5B21B6",
    },
    {
      title: "NGOÀI LỊCH KHÁC",
      value: `${metrics.otherScheduleOrders ?? 0} phiếu`,
      sub: formatVnd(metrics.otherScheduleRevenue),
      accent: "#475569",
      bg: "#FFFFFF",
      stroke: "#E2E8F0",
      valueColor: "#0F172A",
      subColor: "#334155",
    },
  ];

  kpis.forEach((k, idx) => {
    const cx = PADDING_X + idx * (cardW + cardGap);
    svgParts.push(`
      <rect x="${cx}" y="${y}" width="${cardW}" height="${cardH}" rx="12" fill="${k.bg}" stroke="${k.stroke}" stroke-width="1.5" />
      <rect x="${cx}" y="${y}" width="${cardW}" height="6" rx="3" fill="${k.accent}" />
      <text x="${cx + 14}" y="${y + 30}" font-family="${FONT_FAMILY}" font-size="12" font-weight="700" fill="#64748B">${escapeXml(k.title)}</text>
      <text x="${cx + 14}" y="${y + 64}" font-family="${FONT_FAMILY}" font-size="22" font-weight="700" fill="${k.valueColor}">${escapeXml(k.value)}</text>
      <text x="${cx + 14}" y="${y + 90}" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="${k.subColor}">${escapeXml(k.sub)}</text>
    `);
  });
  y += cardH + 26;

  // 3. TIẾN ĐỘ ĐÓNG HÀNG THEO KHO (2 cột song song)
  svgParts.push(`
    <text x="${PADDING_X}" y="${y + 20}" font-family="${FONT_FAMILY}" font-size="20" font-weight="700" fill="#0F172A">CHI TIẾT ĐÓNG HÀNG THEO KHO</text>
  `);
  y += 34;

  const colGap = 20;
  const colW = (INNER_W - colGap) / 2;

  const warehouseLayouts = warehouses.slice(0, 2).map((wh) => {
    const orderedLines = wrapCommaList(wh.scheduled?.branchNames ?? [], 44);
    const missingNames = (wh.missingBranches ?? []).map((b) => b.name);
    const missingLines = wrapCommaList(missingNames, 44);
    const orderedBlockH = 32 + orderedLines.length * 22 + 12;
    const missingBlockH = 32 + missingLines.length * 22 + 12;
    const footerInfoH = 56;
    const totalH = 66 + orderedBlockH + 12 + missingBlockH + 14 + footerInfoH + 14;
    return { wh, orderedLines, missingLines, orderedBlockH, missingBlockH, totalH };
  });

  const maxWhH = warehouseLayouts.reduce((m, l) => Math.max(m, l.totalH), 220);

  warehouseLayouts.forEach((layout, idx) => {
    const wx = PADDING_X + idx * (colW + colGap);
    const { wh, orderedLines, missingLines, orderedBlockH, missingBlockH } = layout;
    const hasMissing = (wh.missingBranches?.length ?? 0) > 0;

    svgParts.push(`
      <rect x="${wx}" y="${y}" width="${colW}" height="${maxWhH}" rx="14" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" />
      <rect x="${wx}" y="${y}" width="${colW}" height="54" rx="14" fill="#1E293B" />
      <rect x="${wx}" y="${y + 40}" width="${colW}" height="14" fill="#1E293B" />
      <text x="${wx + 18}" y="${y + 26}" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#FFFFFF">${escapeXml(wh.name.toUpperCase())}</text>
      <text x="${wx + 18}" y="${y + 45}" font-family="${FONT_FAMILY}" font-size="13" font-weight="400" fill="#CBD5E1">${wh.scheduled?.branches ?? 0} chi nhánh  •  ${wh.scheduled?.orders ?? 0} phiếu  •  ${escapeXml(formatVnd(wh.scheduled?.revenue))}</text>
    `);

    // Khối đã đặt
    let cy = y + 66;
    svgParts.push(`
      <rect x="${wx + 14}" y="${cy}" width="${colW - 28}" height="${orderedBlockH}" rx="10" fill="#F8FAFC" stroke="#E2E8F0" />
      <text x="${wx + 26}" y="${cy + 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#0F766E">ĐÃ ĐẶT HÀNG (${wh.scheduled?.branches ?? 0} CHI NHÁNH)</text>
    `);
    orderedLines.forEach((line, lIdx) => {
      svgParts.push(`
        <text x="${wx + 26}" y="${cy + 44 + lIdx * 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="400" fill="#334155">${escapeXml(line)}</text>
      `);
    });

    // Khối chưa đặt
    cy += orderedBlockH + 12;
    const missBg = hasMissing ? "#FEF2F2" : "#F0FDF4";
    const missStroke = hasMissing ? "#FECACA" : "#BBF7D0";
    const missTitleColor = hasMissing ? "#B91C1C" : "#15803D";
    svgParts.push(`
      <rect x="${wx + 14}" y="${cy}" width="${colW - 28}" height="${missingBlockH}" rx="10" fill="${missBg}" stroke="${missStroke}" />
      <text x="${wx + 26}" y="${cy + 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="${missTitleColor}">CHƯA ĐẶT HÀNG (${wh.missingBranches?.length ?? 0})</text>
    `);
    missingLines.forEach((line, lIdx) => {
      svgParts.push(`
        <text x="${wx + 26}" y="${cy + 44 + lIdx * 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="${hasMissing ? "#991B1B" : "#166534"}">${escapeXml(line)}</text>
      `);
    });

    // Dòng xe ngoài + ngoài lịch
    const fy = y + maxWhH - 60;
    svgParts.push(`
      <line x1="${wx + 14}" y1="${fy}" x2="${wx + colW - 14}" y2="${fy}" stroke="#E2E8F0" stroke-width="1" />
      <text x="${wx + 18}" y="${fy + 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="400" fill="#475569">Gửi xe ngoài: <tspan font-weight="700" fill="#0F172A">${wh.external?.orders ?? 0} phiếu (${escapeXml(formatVnd(wh.external?.revenue))})</tspan></text>
      <text x="${wx + 18}" y="${fy + 44}" font-family="${FONT_FAMILY}" font-size="13" font-weight="400" fill="#475569">Ngoài lịch khác: <tspan font-weight="700" fill="#0F172A">${wh.otherSchedule?.orders ?? 0} phiếu (${escapeXml(formatVnd(wh.otherSchedule?.revenue))})</tspan></text>
    `);
  });

  if (warehouseLayouts.length > 0) {
    y += maxWhH + 26;
  }

  // 4. BẢNG 4 MÃ SIẾT TỒN (SML, SMN, SLTL, MYG)
  if (stockSections.length > 0) {
    svgParts.push(`
      <text x="${PADDING_X}" y="${y + 20}" font-family="${FONT_FAMILY}" font-size="20" font-weight="700" fill="#0F172A">4 MÃ SIẾT TỒN (THEO LỊCH + XE NGOÀI)</text>
    `);
    y += 34;

    const tblGap = 20;
    const tblW = (INNER_W - tblGap) / 2;
    const rowH = 38;
    const maxRows = Math.max(...stockSections.slice(0, 2).map((s) => s.rows.length), 4);
    const tblH = 44 + 34 + maxRows * rowH + 10;

    stockSections.slice(0, 2).forEach((sec, idx) => {
      const tx = PADDING_X + idx * (tblW + tblGap);
      svgParts.push(`
        <rect x="${tx}" y="${y}" width="${tblW}" height="${tblH}" rx="14" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" />
        <rect x="${tx}" y="${y}" width="${tblW}" height="44" rx="14" fill="#0F172A" />
        <rect x="${tx}" y="${y + 30}" width="${tblW}" height="14" fill="#0F172A" />
        <text x="${tx + 18}" y="${y + 28}" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(sec.warehouseName.toUpperCase())}</text>
      `);

      // Table column headers
      const hy = y + 44;
      svgParts.push(`
        <rect x="${tx + 1}" y="${hy}" width="${tblW - 2}" height="34" fill="#F1F5F9" />
        <text x="${tx + 20}" y="${hy + 22}" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#475569">MÃ</text>
        <text x="${tx + 145}" y="${hy + 22}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#475569">CẦN</text>
        <text x="${tx + 245}" y="${hy + 22}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#475569">TỒN</text>
        <text x="${tx + 345}" y="${hy + 22}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#475569">GIỮ</text>
        <text x="${tx + tblW - 20}" y="${hy + 22}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="13" font-weight="700" fill="#475569">KHẢ DỤNG</text>
      `);

      sec.rows.forEach((row, rIdx) => {
        const ry = hy + 34 + rIdx * rowH;
        const isTight = row.available < row.needed;
        const rowBg = rIdx % 2 === 1 ? "#F8FAFC" : "#FFFFFF";
        svgParts.push(`
          <rect x="${tx + 1}" y="${ry}" width="${tblW - 2}" height="${rowH}" fill="${rowBg}" />
          <line x1="${tx + 12}" y1="${ry}" x2="${tx + tblW - 12}" y2="${ry}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${tx + 20}" y="${ry + 25}" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#0F172A">${escapeXml(row.code)}</text>
          <text x="${tx + 145}" y="${ry + 25}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#1E293B">${row.needed}</text>
          <text x="${tx + 245}" y="${ry + 25}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="15" font-weight="400" fill="#475569">${row.stock}</text>
          <text x="${tx + 345}" y="${ry + 25}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="15" font-weight="400" fill="#475569">${row.reserved}</text>
          <text x="${tx + tblW - 20}" y="${ry + 25}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="${isTight ? "#DC2626" : "#059669"}">${row.available}</text>
        `);
      });
    });

    y += tblH + 22;
  }

  // 5. FOOTER / CẦN THEO DÕI
  const alertText =
    report.alerts && report.alerts.length > 0
      ? report.alerts.join(" • ")
      : "Tất cả chỉ số bình thường";
  const alertLines = wrapTextLines(`Cần theo dõi: ${alertText}`, 95);
  const footerH = 30 + alertLines.length * 22 + 24;

  svgParts.push(`
    <rect x="${PADDING_X}" y="${y}" width="${INNER_W}" height="${footerH - 20}" rx="12" fill="#FFFBEB" stroke="#FDE68A" stroke-width="1.5" />
  `);
  alertLines.forEach((line, idx) => {
    svgParts.push(`
      <text x="${PADDING_X + 18}" y="${y + 26 + idx * 22}" font-family="${FONT_FAMILY}" font-size="14" font-weight="700" fill="#92400E">${escapeXml(line)}</text>
    `);
  });
  y += footerH + 10;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${y}" viewBox="0 0 ${WIDTH} ${y}">
  <rect x="0" y="0" width="${WIDTH}" height="${y}" fill="#F1F5F9" />
  ${svgParts.join("\n")}
</svg>`;
}

export function renderMorningReportPng(report: MorningReportJson): Buffer {
  const svg = buildMorningReportSvg(report);
  const fontFiles = resolveFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      fontFiles,
      loadSystemFonts: fontFiles.length === 0,
      defaultFontFamily: FONT_FAMILY,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}
