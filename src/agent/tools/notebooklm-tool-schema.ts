import { z } from "zod";

/**
 * Schema đầu vào của tool `notebooklm`.
 *
 * Theo đúng mẫu `schedule-task-tool-schema.ts`:
 * - `notebookLmWireSchema` là `z.object` PHẲNG ở nút gốc để mọi nhà cung cấp LLM
 *   (kể cả DeepSeek và Google) đều chấp nhận.
 * - `notebookLmInputSchema` là `z.discriminatedUnion("action", ...)` dùng trong
 *   `execute` để kiểm tra tham số bắt buộc theo từng `action` và trả `ketQuaLoi`
 *   chỉ rõ trường thiếu cho model tự gọi lại.
 */

export const MAX_NBLM_TEXT_CHARS = 100_000;
export const MAX_NBLM_QUESTION_CHARS = 4_000;
export const MAX_NBLM_TITLE_CHARS = 200;

export const NOTEBOOKLM_ACTIONS = [
  "add_source",
  "list_sources",
  "ask",
  "generate_audio",
  "generate_video",
  "generate_infographic",
  "generate_slides",
  "generate_report",
] as const;

export const notebookLmInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_source"),
    sourceType: z.enum(["url", "youtube", "text"]),
    url: z.string().url().optional(),
    text: z.string().min(1).max(MAX_NBLM_TEXT_CHARS).optional(),
    title: z.string().min(1).max(MAX_NBLM_TITLE_CHARS).optional(),
  }),
  z.object({
    action: z.literal("list_sources"),
  }),
  z.object({
    action: z.literal("ask"),
    question: z.string().min(1).max(MAX_NBLM_QUESTION_CHARS),
  }),
  z.object({
    action: z.literal("generate_audio"),
    instructions: z.string().max(MAX_NBLM_QUESTION_CHARS).optional(),
    language: z.string().min(2).max(20).optional(),
    caption: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("generate_video"),
    instructions: z.string().max(MAX_NBLM_QUESTION_CHARS).optional(),
    language: z.string().min(2).max(20).optional(),
    videoStyle: z
      .enum(["classroom", "documentary", "animated", "corporate", "cinematic", "minimalist"])
      .optional(),
    videoFormat: z.enum(["brief", "explainer"]).optional(),
    caption: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("generate_infographic"),
    instructions: z.string().max(MAX_NBLM_QUESTION_CHARS).optional(),
    language: z.string().min(2).max(20).optional(),
    infographicFormat: z.enum(["horizontal", "vertical"]).optional(),
    caption: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("generate_slides"),
    instructions: z.string().max(MAX_NBLM_QUESTION_CHARS).optional(),
    language: z.string().min(2).max(20).optional(),
    presentationStyle: z.enum(["detailed_slideshow", "presenter_notes"]).optional(),
    presentationLength: z.enum(["short", "default"]).optional(),
  }),
  z.object({
    action: z.literal("generate_report"),
    language: z.string().min(2).max(20).optional(),
    reportFormat: z.enum(["summary", "detailed"]).optional(),
  }),
]);

export const notebookLmWireSchema = z.object({
  action: z
    .enum(NOTEBOOKLM_ACTIONS)
    .describe(
      "Hành động cần thực hiện: add_source (nạp nguồn), list_sources (xem nguồn đã nạp), " +
        "ask (hỏi đáp có trích dẫn), generate_audio (tạo podcast MP3), generate_video (tạo video MP4), " +
        "generate_infographic (tạo ảnh infographic PNG), generate_slides (tạo Google Slides), " +
        "generate_report (tạo báo cáo tổng hợp).",
    ),
  sourceType: z
    .enum(["url", "youtube", "text"])
    .optional()
    .describe("BẮT BUỘC với add_source: 'url' (trang web), 'youtube' (video YouTube), hoặc 'text' (văn bản trực tiếp)."),
  url: z
    .string()
    .optional()
    .describe("BẮT BUỘC khi action='add_source' và sourceType là 'url' hoặc 'youtube'."),
  text: z
    .string()
    .max(MAX_NBLM_TEXT_CHARS)
    .optional()
    .describe("BẮT BUỘC khi action='add_source' và sourceType='text'. Nội dung văn bản cần nạp vào sổ tay."),
  title: z
    .string()
    .max(MAX_NBLM_TITLE_CHARS)
    .optional()
    .describe("Tiêu đề nguồn tài liệu (tùy chọn cho add_source, nên đặt rõ ràng khi sourceType='text')."),
  question: z
    .string()
    .max(MAX_NBLM_QUESTION_CHARS)
    .optional()
    .describe("BẮT BUỘC với action='ask'. Câu hỏi cần tra cứu và trích dẫn từ sổ tay NotebookLM."),
  instructions: z
    .string()
    .max(MAX_NBLM_QUESTION_CHARS)
    .optional()
    .describe("Hướng dẫn trọng tâm tùy chọn cho generate_audio, generate_video, generate_infographic, generate_slides."),
  language: z
    .string()
    .max(20)
    .optional()
    .describe('Mã ngôn ngữ đầu ra (mặc định "vi" cho tiếng Việt).'),
  videoStyle: z
    .enum(["classroom", "documentary", "animated", "corporate", "cinematic", "minimalist"])
    .optional()
    .describe("Phong cách video (tùy chọn cho generate_video)."),
  videoFormat: z
    .enum(["brief", "explainer"])
    .optional()
    .describe("Định dạng video: 'brief' (ngắn gọn) hoặc 'explainer' (giải thích chi tiết)."),
  infographicFormat: z
    .enum(["horizontal", "vertical"])
    .optional()
    .describe("Bố cục infographic: 'horizontal' (ngang) hoặc 'vertical' (dọc)."),
  presentationStyle: z
    .enum(["detailed_slideshow", "presenter_notes"])
    .optional()
    .describe("Kiểu slide: 'detailed_slideshow' hoặc 'presenter_notes'."),
  presentationLength: z
    .enum(["short", "default"])
    .optional()
    .describe("Độ dài bộ slide: 'short' hoặc 'default'."),
  reportFormat: z
    .enum(["summary", "detailed"])
    .optional()
    .describe("Định dạng báo cáo: 'summary' (tóm tắt) hoặc 'detailed' (chi tiết)."),
  caption: z
    .string()
    .max(1000)
    .optional()
    .describe("Lời nhắn gửi kèm file âm thanh/video/infographic trên Zalo."),
});

export type NotebookLmWireInput = z.infer<typeof notebookLmWireSchema>;
export type NotebookLmInput = z.infer<typeof notebookLmInputSchema>;
