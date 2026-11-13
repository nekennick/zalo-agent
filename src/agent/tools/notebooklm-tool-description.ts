/**
 * Mô tả công cụ `notebooklm` cho LLM (mục 14.4).
 */
export const NOTEBOOKLM_TOOL_DESCRIPTION =
  "Làm việc với sổ tay Google NotebookLM riêng của cuộc trò chuyện này: " +
  "nạp tài liệu (link web, YouTube, văn bản), hỏi đáp có trích dẫn nguồn chính xác từ sổ tay, " +
  "và tạo các sản phẩm Studio gồm Audio Overview (podcast MP3 tự gửi vào chat), Video (MP4 tự gửi vào chat), " +
  "Infographic (ảnh PNG tự gửi vào chat), Slide (xuất link Google Slides), hoặc Báo cáo tổng hợp.\n" +
  "Mỗi cuộc trò chuyện tự động có một sổ tay riêng biệt - không cần người dùng đưa link NotebookLM.\n" +
  "Khi dùng:\n" +
  "- Người dùng gửi link/văn bản và bảo lưu/nạp vào NotebookLM -> action='add_source'.\n" +
  "- Hỏi đáp/tra cứu dựa trên các nguồn đã nạp trong NotebookLM -> action='ask'.\n" +
  "- Yêu cầu tạo podcast / Audio Overview -> action='generate_audio' (tự đổi sang MP3 và gửi file).\n" +
  "- Yêu cầu tạo video giải thích từ NotebookLM -> action='generate_video' (tự gửi file MP4).\n" +
  "- Yêu cầu tạo infographic tóm tắt từ NotebookLM -> action='generate_infographic' (tự gửi ảnh PNG).\n" +
  "- Yêu cầu tạo slide thuyết trình từ NotebookLM -> action='generate_slides' (trả về link Google Slides).\n" +
  "- Yêu cầu tạo báo cáo (briefing doc) từ NotebookLM -> action='generate_report'.\n" +
  "- Xem sổ tay hiện có những nguồn nào -> action='list_sources'.";
