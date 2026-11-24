import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-catalog-types.js";
import { createLogger } from "../../shared/logger.js";
import { lookupKiotVietProduct, type KiotVietProduct } from "../../inventory/kiotviet-catalog.js";
import { isWarehouseThread } from "../../middleware/allowlist-filter.js";
import { isInventoryMessageRecalled, rememberInventoryMessage } from "../../inventory/inventory-message-store.js";
import { postInventoryDashboard, YAGAMI_DASHBOARD_PENDING_URL } from "../../inventory/inventory-dashboard-client.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

const log = createLogger("tool:record-inventory-import");

export { YAGAMI_DASHBOARD_PENDING_URL } from "../../inventory/inventory-dashboard-client.js";

function activeInventoryMessages(ctx: ToolContext): ParsedMessage[] {
  const messages = ctx.inventoryMessages?.() ?? (ctx.batch?.length ? ctx.batch : ctx.message ? [ctx.message] : []);
  return messages.filter((m) => {
    const accountId = m.accountId || ctx.account?.id || "";
    return !m.isSelf && (!ctx.account?.id || accountId === ctx.account.id)
      && (!ctx.message?.threadId || m.threadId === ctx.message.threadId)
      && !isInventoryMessageRecalled({ accountId, threadId: m.threadId, msgId: m.msgId });
  });
}

function normalizedItemName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

function matchesSourceRow(item: InventoryItem, row: InventoryItem): boolean {
  const name = normalizedItemName(item.tenHang);
  return Boolean(name) && row.soLuong === item.soLuong
    && ` ${normalizedItemName(row.tenHang)} `.includes(` ${name} `);
}

export function extractFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

/**
 * Kiểm tra xem một mặt hàng có thực sự xuất hiện trong batch tin nhắn của lượt hiện tại hay không.
 * Ngăn chặn tuyệt đối tình trạng Model bị ảo giác quét lại các món từ lịch sử chat cũ của hôm trước.
 */
export function isItemInCurrentBatch(item: InventoryItem, ctx: ToolContext): boolean {
  return activeInventoryMessages(ctx).some((msg) =>
    parseItemsFromText(msg.text || "").some((row) => matchesSourceRow(item, row)));
}

/**
 * Tìm tin nhắn Zalo gốc tương ứng của từng món hàng trong batch.
 * Đảm bảo mỗi món hàng có đúng tin Zalo gốc, đúng thời gian gửi (sentAt) và đúng người báo (senderName).
 */
export function findSourceMessageForInventoryItem(
  item: InventoryItem,
  ctx: ToolContext,
): { sentAt: string; rawMessage: string; senderName: string; senderId: string;
  accountId: string; threadId: string; msgId: string; cliMsgId: string } {
  const msg = activeInventoryMessages(ctx).find((candidate) =>
    parseItemsFromText(candidate.text || "").some((row) => matchesSourceRow(item, row))) ?? ctx.message;
  return sourceInfoForMessage(msg, ctx);
}

function sourceInfoForMessage(msg: ParsedMessage | undefined, ctx: ToolContext) {
  return {
    accountId: msg?.accountId || ctx.account?.id || "",
    threadId: msg?.threadId || ctx.message?.threadId || "",
    msgId: msg?.msgId || "",
    cliMsgId: msg?.cliMsgId || "",
    sentAt: msg?.sentAt || ctx.message?.sentAt || new Date().toISOString(),
    rawMessage: msg?.text || "",
    senderName: msg?.senderName || ctx.message?.senderName || "Nhân viên",
    senderId: msg?.senderId || ctx.message?.senderId || "",
  };
}

/**
 * Tìm mốc thời gian tin nhắn Zalo gửi đến của từng món hàng.
 * Giữ lại để tương thích ngược với các test.
 */
export function findSentAtForInventoryItem(item: InventoryItem, ctx: ToolContext): string {
  return findSourceMessageForInventoryItem(item, ctx).sentAt;
}

export const inventoryItemSchema = z.object({
  tenHang: z.string().min(1).describe("Tên mặt hàng cần nhập (ví dụ: 'Thịt bò', 'Mì Hảo Hảo', 'Chân bàn chữ C'...)"),
  soLuong: z.number().describe("Số lượng cần nhập (ví dụ: 5, 10, 20000...)"),
  dvt: z.string().optional().describe("Đơn vị viết trong tin báo nhận (ví dụ: 'kg', 'bịch', 'gói', 'thùng', 'cái')."),
  ghiChu: z.string().optional().describe("Ghi chú thêm nếu có"),
});

export type InventoryItem = z.infer<typeof inventoryItemSchema>;

const reportedUnits: Record<string, string> = {
  c: "cái", "cái": "cái", ly: "ly", th: "thùng", "thùng": "thùng", kg: "kg",
  b: "b", "bịch": "bịch", "gói": "gói", "hộp": "hộp", lon: "lon", bao: "bao",
};
const unitPattern = Object.keys(reportedUnits).join("|");
const quantityWithUnit = new RegExp(
  `(?:^|[\\s,;]+)(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})\\s+`, "giu",
);
const trailingQuantityWithUnit = new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})$`, "iu");
const reportPrefix = /^(?:đã nhận|báo nhận|đã nhập|đã về|nhận|nhập|da nhan|bao nhan|da nhap|da ve|nhan|nhap)(?=\s|:|$)\s*:?\s*/iu;

export function hasInventoryReportPrefix(text: string): boolean {
  return reportPrefix.test(text.trim());
}

/**
 * Hàm phân tích dự phòng: tự động bóc tách số lượng và tên món từ nội dung tin nhắn Zalo
 * nếu model LLM sơ suất không truyền trường `items`.
 */
export function parseItemsFromText(text: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  const explicitReport = hasInventoryReportPrefix(text);
  for (const rawLine of text.normalize("NFC").split(/\r?\n/)) {
    const trimmed = rawLine.trim().replace(/^[-•]\s+/u, "");
    const hasReportPrefix = explicitReport || hasInventoryReportPrefix(trimmed);
    const line = trimmed.replace(reportPrefix, "");
    if (!/^\d/u.test(line)) {
      const trailing = hasReportPrefix ? line.match(trailingQuantityWithUnit) : null;
      if (trailing) addItem(trailing[2], trailing[1], reportedUnits[trailing[3].toLowerCase()]);
      continue;
    }

    const markers = [...line.matchAll(quantityWithUnit)];
    const firstMarker = markers[0]?.index ?? line.length;
    const withoutUnit = line.slice(0, firstMarker).match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
    if (hasReportPrefix && withoutUnit && !Object.hasOwn(reportedUnits, withoutUnit[2].trim().toLowerCase())) {
      addItem(withoutUnit[1], withoutUnit[2]);
    }

    for (const [index, marker] of markers.entries()) {
      const start = marker.index + marker[0].length;
      const end = markers[index + 1]?.index ?? line.length;
      addItem(marker[1], line.slice(start, end), reportedUnits[marker[2].toLowerCase()]);
    }
  }
  return items;

  function addItem(quantity: string, name: string, dvt?: string): void {
    const soLuong = Number(quantity.replace(",", "."));
    const tenHang = name.replace(/[\s,;]+$/u, "").trim();
    if (Number.isFinite(soLuong) && soLuong > 0 && tenHang) {
      items.push({ tenHang, soLuong, ...(dvt && { dvt }) });
    }
  }
}

function bindItemsToSources(items: InventoryItem[], ctx: ToolContext) {
  const available = activeInventoryMessages(ctx)
    .filter((msg) => Boolean(msg.msgId))
    .flatMap((msg) => parseItemsFromText(msg.text || "").map((row) => ({ msg, row })));
  const used = new Set<InventoryItem>();
  return items.flatMap((item, originalIndex) => {
    const matches = available.filter(({ row }) => !used.has(row) && matchesSourceRow(item, row));
    const exact = matches.filter(({ row }) => normalizedItemName(row.tenHang) === normalizedItemName(item.tenHang));
    const candidates = exact.length > 0 ? exact : matches;
    const source = candidates[0];
    if (!source || candidates.some(({ msg }) => msg !== source.msg)) return [];
    used.add(source.row);
    return [{ item: source.row, sourceInfo: sourceInfoForMessage(source.msg, ctx), originalIndex }];
  });
}

export function createRecordInventoryImportTool(ctx: ToolContext) {
  return tool({
    description:
      "Tự động tra cứu mã hàng KiotViet từ danh mục và gửi danh sách hàng nhận kho sang Yagami Dashboard để duyệt. Tự động nhận diện ngữ cảnh các món đi kèm.",
    inputSchema: z.object({
      items: z
        .array(inventoryItemSchema)
        .optional()
        .describe("Danh sách các mặt hàng cần nhập được báo trong tin nhắn"),
      nhanVien: z
        .string()
        .optional()
        .describe("Tên nhân viên báo hàng (chỉ điền tên, ví dụ: 'Khoa', 'Châu', 'Phượng')."),
      tenHang: z.string().optional().describe("Tên mặt hàng (nếu gọi lẻ)"),
      soLuong: z.number().optional().describe("Số lượng (nếu gọi lẻ)"),
      dvt: z.string().optional().describe("Đơn vị tính (nếu gọi lẻ)"),
    }),
    execute: async ({ items: inputItems, nhanVien, tenHang, soLuong, dvt }) => {
      if (!isWarehouseThread(ctx.message?.threadId || "")) {
        log.warn({ threadId: ctx.message?.threadId }, "Bỏ qua ghi nhận hàng: không phải nhóm nhận hàng");
        return {
          success: false,
          silent: true,
          message: "Chức năng chỉ hoạt động trong nhóm Báo Nhận Hàng Kho Tổng Cao Lãnh",
        };
      }

      let items: InventoryItem[] = inputItems || [];
      if (items.length === 0) {
        if (tenHang && typeof soLuong === "number") {
          items = [{ tenHang, soLuong, dvt }];
        } else {
          const latestText = activeInventoryMessages(ctx).reverse().find((msg) => msg.text?.trim())?.text;
          if (latestText) items = parseItemsFromText(latestText);
        }
      }

      if (items.length === 0) {
        log.warn({ text: ctx.message?.text }, "Không trích xuất được món hàng nào từ tin nhắn");
        return {
          success: false,
          silent: true,
          message: "Không tìm thấy mặt hàng nào trong tin nhắn",
        };
      }

      // Lọc bỏ triệt để các món hàng không hề xuất hiện trong tin nhắn của lượt hiện tại (chặn ảo giác quét lại tin cũ)
      const validItems = bindItemsToSources(items, ctx);

      if (validItems.length === 0) {
        log.warn({ text: ctx.message?.text }, "Không có mặt hàng nào thuộc tin nhắn hiện tại");
        return {
          success: false,
          silent: true,
          message: "Các mặt hàng do AI trích xuất không thuộc tin nhắn hiện tại",
        };
      }

      const senderRaw = nhanVien || ctx.message.senderName || "Nhân viên";
      const senderName = extractFirstName(senderRaw);

      // Bước 1: Giữ nguyên index gốc để sau khi nhận diện context thì khôi phục lại thứ tự tin nhắn của người gửi
      // Sắp xếp các món theo độ dài tên giảm dần (để các món có tên chi tiết như 'nắp ly' được nhận diện trước, cung cấp context cho món ngắn như 'ly')
      const sortedItems = [...validItems].sort((a, b) => b.item.tenHang.length - a.item.tenHang.length);

      const productsBySource = new Map<string, KiotVietProduct[]>();
      const itemAnalyses = [];

      for (const { item, originalIndex, sourceInfo } of sortedItems) {
        let finalCode = "";
        let finalName = item.tenHang;
        if (!sourceInfo.accountId || !sourceInfo.threadId || !sourceInfo.msgId) continue;
        rememberInventoryMessage({ ...sourceInfo, text: sourceInfo.rawMessage });
        const itemSenderName = nhanVien ? extractFirstName(nhanVien) : extractFirstName(sourceInfo.senderName);
        const recognizedProducts = productsBySource.get(sourceInfo.msgId) ?? [];
        productsBySource.set(sourceInfo.msgId, recognizedProducts);

        const kvRes = await lookupKiotVietProduct(item.tenHang, recognizedProducts, item.dvt);

        if (kvRes.product) {
          finalCode = kvRes.product.code;
          finalName = kvRes.product.name;
          recognizedProducts.push(kvRes.product);
          itemAnalyses.push({
            sourceInfo,
            originalIndex,
            sentAt: sourceInfo.sentAt,
            rawMessage: sourceInfo.rawMessage,
            senderName: itemSenderName,
            senderId: sourceInfo.senderId,
            status: "ready",
            item,
            finalCode,
            finalName,
            coMaKiotViet: true,
          });
        } else if (kvRes.ambiguous && kvRes.candidates && kvRes.candidates.length > 0) {
          itemAnalyses.push({
            sourceInfo,
            originalIndex,
            sentAt: sourceInfo.sentAt,
            rawMessage: sourceInfo.rawMessage,
            senderName: itemSenderName,
            senderId: sourceInfo.senderId,
            status: "ambiguous",
            item,
            candidates: kvRes.candidates,
            suggestedQuestion: kvRes.suggestedQuestion,
          });
        } else {
          // Không tìm thấy trong KiotViet
          itemAnalyses.push({
            sourceInfo,
            originalIndex,
            sentAt: sourceInfo.sentAt,
            rawMessage: sourceInfo.rawMessage,
            senderName: itemSenderName,
            senderId: sourceInfo.senderId,
            status: "not_found",
            item,
            finalCode: "",
            finalName: item.tenHang,
            coMaKiotViet: false,
          });
        }
      }

      // Khôi phục thứ tự chuẩn 100% theo thời gian gửi trên Zalo (sentAt tăng dần), nếu trùng thì theo originalIndex
      itemAnalyses.sort((a, b) => {
        const timeA = new Date(a.sentAt).getTime();
        const timeB = new Date(b.sentAt).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return a.originalIndex - b.originalIndex;
      });

      // Chuẩn bị payload gửi sang Yagami Dashboard
      const payloadItems = itemAnalyses.filter((a) => !isInventoryMessageRecalled(a.sourceInfo)).map((a) => {
        const d = new Date(a.sentAt);
        const receivedDate = d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const receivedTime = d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
        return {
          sourceAccountId: a.sourceInfo.accountId,
          sourceMessageId: a.sourceInfo.msgId,
          sourceCliMsgId: a.sourceInfo.cliMsgId,
          threadId: a.sourceInfo.threadId,
          rawItemName: a.item.tenHang,
          quantity: a.item.soLuong,
          unit: a.item.dvt || "chưa rõ",
          status: (a.status === "ready" ? "READY" : a.status === "ambiguous" ? "AMBIGUOUS" : "UNMATCHED") as
            | "READY"
            | "AMBIGUOUS"
            | "UNMATCHED",
          matchedCode: a.finalCode || "",
          matchedName: a.finalName || "",
          candidates: a.candidates || [],
          sentAt: a.sentAt,
          receivedDate,
          receivedTime,
          rawMessage: a.rawMessage,
          senderName: a.senderName,
          senderId: a.senderId,
        };
      });

      if (payloadItems.length === 0) {
        return { success: true, totalItems: 0, silent: true, message: "Tin nguồn không còn hợp lệ hoặc đã thu hồi" };
      }

      let saveSuccess = false;
      let completeSourceMessageIds: string[] = [];
      try {
        log.info(
          { url: YAGAMI_DASHBOARD_PENDING_URL, count: payloadItems.length, sender: senderName },
          "Đang gửi hàng nhận Zalo sang Yagami Dashboard...",
        );

        const receipt = await postInventoryDashboard({
          senderName,
          senderId: ctx.message.senderId,
          threadId: ctx.message.threadId,
          rawMessage: ctx.message.text,
          items: payloadItems,
        });
        saveSuccess = receipt.success;
        if (saveSuccess && receipt.count === payloadItems.length) {
          completeSourceMessageIds = activeInventoryMessages(ctx).filter((msg) => {
            const sent = payloadItems.filter((item) => item.sourceMessageId === msg.msgId).length;
            return sent > 0 && sent === parseItemsFromText(msg.text).length;
          }).map((msg) => msg.msgId);
        }
        log.info({ saveSuccess, completeSourceMessageIds }, "Kết quả lưu hàng Zalo vào Dashboard");
      } catch (err: unknown) {
        log.error({ err }, "Lỗi kết nối Yagami Dashboard khi lưu hàng nhận Zalo");
      }

      return {
        success: saveSuccess,
        totalItems: payloadItems.length,
        completeSourceMessageIds,
        silent: true,
        instruction:
          "QUY TẮC BẮT BUỘC (MANDATORY): Dữ liệu đã được lưu trực tiếp vào hàng đợi chờ duyệt trên trang Yagami Dashboard. Bạn HOÀN TOÀN IM LẶNG, TUYỆT ĐỐI KHÔNG gửi bất kỳ tin nhắn phản hồi nào vào nhóm Zalo.",
      };
    },
  });
}
