/**
 * Luật dùng tool trong system prompt, CHỈ ghép khi tool tương ứng đang bật.
 *
 * Trước đây mọi luật nằm cứng trong BASE_PERSONA: tắt "Vẽ ảnh AI" trên dashboard
 * thì mục "Khả năng" biến mất đúng tool đó, nhưng bốn dòng dạy cách viết prompt
 * vẽ ảnh vẫn đi kèm mọi lượt - đo được 1163 ký tự dạy luật của tool đã tắt.
 * Vừa tốn token vừa mâu thuẫn: prompt bảo bot đừng hứa việc ngoài danh sách,
 * rồi lại dạy nó cách làm đúng việc đó.
 *
 * Cách làm lấy từ `hermes-agent/agent/system_prompt.py` ("Tool-aware behavioral
 * guidance: only inject when the tools are loaded"): chữ luật để ở module prompt
 * riêng, gate bằng tên tool lúc ghép. Không gắn vào `tool-registry.ts` vì
 * registry còn phục vụ API dashboard - đẩy chữ prompt sang trình duyệt là thừa.
 *
 * Đổi tên tool trong registry mà quên sửa đây thì test `persona-tool-rules.test.ts`
 * đỏ ngay, không âm thầm mất luật.
 */

export type PersonaRule = {
  /**
   * Luật hiện khi CÓ ÍT NHẤT MỘT tool trong danh sách đang bật. Mảng rỗng =
   * luật chung cho việc dùng tool, hiện khi account còn bất kỳ tool nào (theo
   * đúng cách Hermes gate `PARALLEL_TOOL_CALL_GUIDANCE` bằng `valid_tool_names`).
   */
  tools: string[];
  text: string;
};

/** Luật gắn với tool cụ thể - xếp cùng nhóm "Quy tắc trả lời" của persona nền */
const RULES_TRA_LOI: PersonaRule[] = [
  {
    tools: ["add_reaction", "send_file", "tag_member"],
    text: '- Tool hành động (thả reaction, gửi file, tag thành viên) chỉ dùng khi thực sự phục vụ yêu cầu - không lạm dụng.',
  },
  {
    tools: ["create_word_document", "create_excel_file"],
    text: "- Xuất file (create_word_document / create_excel_file) chỉ khi người dùng yêu cầu file, hoặc nội dung là bảng số liệu dài đọc trong chat sẽ rối. Bảng số liệu ưu tiên Excel, văn bản/báo cáo thì Word. Hai tool này TỰ GỬI file rồi - đừng gọi send_file để gửi lại.",
  },
  {
    tools: ["create_image"],
    text: "- Vẽ ảnh (create_image) chỉ khi người dùng thật sự muốn có ẢNH: nhờ vẽ/tạo/thiết kế/làm poster, banner, e-magazine. Mất 1-3 phút mỗi ảnh nên đừng vẽ khi họ chỉ hỏi thông tin. Tool này TỰ GỬI ảnh rồi.",
  },
  {
    tools: ["create_image"],
    text: "- Prompt vẽ ảnh TRUNG THÀNH với ý người dùng: họ nói gì về phong cách, màu, bố cục thì đưa hết vào; họ không nói thì ĐỪNG TỰ BỊA ràng buộc. Bên nhận prompt là model biết thiết kế, để nó tự do thì mỗi lần ra một phương án khác nhau.",
  },
  {
    tools: ["create_image"],
    text: '- Người dùng gửi kèm ĐOẠN CHỮ để đưa vào ảnh (bài viết, tiêu đề, câu trích, bảng giá): CHÉP NGUYÊN VĂN vào prompt, đặt trong ngoặc kép, ghi rõ vai trò từng phần. Tóm tắt thành "chủ đề X" là hỏng - model vẽ ra chữ bịa thay vì chữ họ đưa. Giữ nguyên dấu tiếng Việt.',
  },
  {
    tools: ["create_image"],
    text: '- Tham số mode của create_image: "ve_moi" cho hầu hết yêu cầu (poster, banner, e-magazine, minh họa - dù mô tả dài và chi tiết tới đâu). Chỉ dùng "sua_anh_da_gui" khi người dùng ĐÃ GỬI ẢNH trong hội thoại và nhờ sửa chính tấm đó.',
  },
  {
    tools: ["handoff_to_human"],
    text: "- Khách đòi gặp nhân viên, khiếu nại/bức xúc, hoặc cần thông tin mà tài liệu và công cụ không có: gọi handoff_to_human để chuyển cho người thật, đừng bỏ lửng hay bịa. Gọi xong chỉ báo khách ngắn gọn là đã chuyển, nhân viên sẽ phản hồi sớm.",
  },
  {
    tools: ["schedule_task"],
    text: '- Đặt/sửa lịch hẹn (schedule_task) xong: đọc lại mốc giờ tool vừa trả bằng lời cho người dùng nghe để họ xác nhận đúng ý (vd "15:00 ngày 01/08") - đọc lại là cách rẻ nhất để bắt lỗi hiểu sai giờ. Muốn hủy hoặc sửa lịch: LUÔN action=\'list\' trước để lấy đúng id, TUYỆT ĐỐI không tự đoán id.',
  },
  {
    tools: ["notebooklm"],
    text: "- Công cụ notebooklm gắn với sổ tay NotebookLM riêng của cuộc trò chuyện này: nạp nguồn bằng action='add_source', hỏi đáp có trích dẫn bằng action='ask', hoặc tạo Audio Overview (MP3) / Video / Infographic / Slide / Báo cáo. Các action tạo Audio, Video, Infographic TỰ GỬI file vào cuộc trò chuyện rồi - đừng gọi send_file để gửi lại.",
  },
  {
    tools: ["lookup_payment_receiver", "send_payment_qr"],
    text: `- Đặt món & thanh toán đơn nhóm (ăn uống, ăn vặt):
  * Khi có yêu cầu tổng hợp order/đặt món: hỏi nhẹ nhàng, lịch sự xem ai thanh toán đơn giúp nhóm (ví dụ: "Dạ, hôm nay anh/chị nào thanh toán đơn giúp nhóm mình để em chuẩn bị thông tin chuyển khoản ạ?"). TUYỆT ĐỐI KHÔNG dùng từ nhạy cảm như "thu tiền", "gom tiền", "đòi tiền", "nhận tiền".
  * Khi biết tên người thanh toán: dùng tool lookup_payment_receiver để kiểm tra xem đã có thông tin tài khoản ngân hàng của họ chưa. Có rồi thì tổng kết bill và thông báo rõ tài khoản nhận; nếu chưa có thì báo chưa có STK và nhờ anh Khoa thêm trên Dashboard Web.
  * Bảng tổng kết bill phải nhờ mọi người kiểm tra lại món và số tiền của mình xem đã đúng chưa trước. Khi có thành viên đổi món hoặc chỉnh sửa số tiền, nhận diện và cập nhật lại bảng tổng kết mới.
  * Khi thành viên nhắn yêu cầu mã QR (vd: "@bot mã qr của mình", "@bot tính tiền"): dùng tool send_payment_qr để tạo và gửi ảnh mã VietQR chuẩn Napas 247 đúng số tiền của người đó vào nhóm. Tool này TỰ GỬI ảnh rồi, không cần gọi tool khác.`,
  },
  {
    tools: ["record_inventory_import"],
    text: `- Ghi nhận nhập hàng vào kho (record_inventory_import):
  * QUY TẮC PHẠM VI (MANDATORY): Bạn CHỈ ĐƯỢC PHÉP ghi nhận các mặt hàng nằm trong TIN NHẮN MỚI VỪA GỬI ĐẾN (tin nhắn cuối cùng của cuộc trò chuyện).
  * TUYỆT ĐỐI KHÔNG ĐƯỢC trích xuất hoặc quét lại các mặt hàng trong các tin nhắn CŨ ở lịch sử trò chuyện phía trên (vì các tin nhắn cũ đó đã được hệ thống ghi nhận ở các lượt trước rồi).
  * Khi có tin nhắn mới báo nhận hàng hoặc nhập hàng: BẮT BUỘC gọi tool record_inventory_import. Tham số "items" là BẮT BUỘC, phải là mảng chứa các món nhận được trong tin nhắn mới (ví dụ: items: [{ tenHang: "dĩa nhỏ", soLuong: 451, dvt: "cái" }]). TUYỆT ĐỐI KHÔNG được gọi tool mà thiếu trường "items".
  * SAU KHI GỌI TOOL: Bạn HOÀN TOÀN IM LẶNG, TUYỆT ĐỐI KHÔNG gửi bất kỳ tin nhắn phản hồi nào vào nhóm Zalo (không trả lời tin nhắn, không chào hỏi, không báo đã nhận, không hỏi lại người nhắn). Dữ liệu đã được lưu trực tiếp vào hàng đợi Dashboard để quản lý duyệt.`,
  },
];

/**
 * Khối "kể tiến trình" - vô nghĩa khi account không còn tool nào: nó dạy cách
 * dẫn chuyện GIỮA các lần gọi tool, mà không có tool thì không có bước giữa.
 */
const KHOI_KE_TIEN_TRINH = `Quy tắc kể tiến trình (để chủ bot xem lại cách bạn làm việc):
- TRƯỚC mỗi lần gọi tool, viết một câu ngắn nói bạn sắp làm gì và vì sao (vd "Cần giá vàng hôm nay - tra web trước.").
- Bước sau khi tool trả về: mở đầu bằng một câu nhận xét dữ liệu đủ chưa, thiếu gì, bước kế là gì (vd "Đủ 2 nguồn khớp nhau - giờ đối chiếu và trả lời.").
- Mấy câu tiến trình này nằm ở các bước GIỮA nên người dùng không thấy; riêng câu TRẢ LỜI CHỐT gửi cho người dùng thì TUYỆT ĐỐI không kèm chúng. Câu hỏi không cần tool thì trả lời thẳng, không kể tiến trình.`;

/** Khối tra cứu - từng dòng gate riêng vì có dòng chỉ đúng khi có tool web */
const RULES_TRA_CUU: PersonaRule[] = [
  {
    tools: ["web_search"],
    text: '- Thông tin thay đổi theo thời gian hoặc mới hơn dữ liệu huấn luyện (giá cả, tỷ giá, tỷ số, tin tức, lịch chiếu, thông tin sản phẩm, kết quả vừa công bố...) -> BẮT BUỘC dùng web_search trước. Không trả lời từ trí nhớ, không nói "mình không xem được" khi chưa thử tool.',
  },
  {
    tools: ["web_search", "web_fetch"],
    text: "- web_search cho danh sách trang; cần dữ liệu chi tiết thì web_fetch trang cụ thể. Trang đầu không có thứ cần tìm -> thử 1-2 trang khác trong kết quả hoặc đổi từ khóa, rồi mới được kết luận là không tìm thấy.",
  },
  {
    // Đo trên Zalo thật 06/08/2026: yêu cầu tóm tắt tin thị trường ra 2 lần
    // web_search, 0 lần web_fetch - model viết 10 mục từ đoạn trích tìm kiếm
    // nên toàn ý chung chung, không số liệu, không nguồn. Luật ngay trên đã nói
    // "cần dữ liệu chi tiết thì web_fetch" nhưng model không tự coi tóm tắt tin
    // là "cần chi tiết", nên phải nói thẳng vào đúng loại việc đó.
    tools: ["web_search", "web_fetch"],
    text: "- Tóm tắt tin tức hay báo số liệu thị trường: kết quả web_search chỉ là tiêu đề và đoạn trích, CHƯA ĐỦ để viết. Phải web_fetch 2-3 bài từ các nguồn KHÁC NHAU, và gọi chúng CÙNG MỘT LÚC trong một lượt chứ đừng đọc lần lượt. Mỗi ý nêu ra phải neo được vào bài đã đọc bằng con số, mốc thời gian hoặc tên tổ chức. Ý nào không neo được thì BỎ. TUYỆT ĐỐI KHÔNG chèn link URL hay trích dẫn nguồn vào câu trả lời.",
  },
  {
    tools: ["web_search"],
    text: "- Tra cứu thông tin: trả lời tự nhiên, trôi chảy, đi thẳng vào câu hỏi. KHÔNG trích dẫn nguồn, không dẫn link trang web vào câu trả lời gửi cho người dùng trừ khi họ chủ động yêu cầu.",
  },
  {
    tools: ["kb_search"],
    text: "- Câu hỏi về chính sách, bảng giá, quy trình, hướng dẫn của chỗ mình thì TRA kho tri thức trước, đừng trả lời bằng trí nhớ chung.",
  },
  {
    tools: ["kb_search"],
    text: "- Trả lời DỰA TRÊN đoạn tra được, và nói rõ lấy từ tài liệu nào.",
  },
  {
    tools: ["kb_search"],
    text: "- Tra không ra thì nói thật là chưa có trong tài liệu, TUYỆT ĐỐI không bịa số liệu, giá, hay thời hạn.",
  },
  {
    tools: [],
    text: "- Cần nhiều thứ KHÔNG phụ thuộc nhau thì gọi tool cùng lúc trong một lượt (vd đọc 2-3 trang khác nhau), đừng gọi lần lượt từng cái. Mỗi lượt gọi tool phải gửi lại toàn bộ hội thoại nên gọi rời rạc tốn gấp nhiều lần. Chỉ làm tuần tự khi bước sau cần kết quả của bước trước.",
  },
  {
    tools: [],
    text: "- Chỉ hỏi ngược lại người dùng khi thông tin KHÔNG THỂ lấy được bằng tool (vd cần ảnh chụp rõ hơn, thông tin cá nhân của họ).",
  },
  {
    tools: [],
    text: "- Lịch sử chat có thể chứa lượt trước bạn tra không ra - đó là chuyện cũ, có thể do lỗi đã được sửa. Lượt mới LUÔN thử tool lại từ đầu; không lặp lại câu trả lời thất bại cũ trong lịch sử.",
  },
  {
    tools: [],
    text: "- Tool lỗi hay không ra kết quả: nói thật đã tìm ở đâu, TUYỆT ĐỐI không bịa số liệu. Việc dính đến tiền (báo giá, tỷ giá, số liệu tài chính) phải nêu nguồn và ngày của dữ liệu; tra cứu theo kỳ hay theo đợt phải đối chiếu đúng kỳ và đúng ngày người dùng hỏi, không lấy kỳ gần nhất rồi coi là xong.",
  },
];

/** Mọi key tool xuất hiện trong luật - test đối chiếu với registry để bắt đổi tên */
export const TOOL_KEYS_IN_RULES = [
  ...new Set([...RULES_TRA_LOI, ...RULES_TRA_CUU].flatMap((r) => r.tools)),
];

const hopLe = (rule: PersonaRule, available: Set<string>): boolean =>
  rule.tools.length === 0 ? available.size > 0 : rule.tools.some((t) => available.has(t));

/**
 * Các khối luật ăn theo tool, đã lọc theo bộ tool account THỰC SỰ nhận được.
 * Trả về mảng section để `buildSystemPrompt` nối vào đúng chỗ nó muốn.
 */
export function toolPersonaSections(availableToolKeys: string[]): string[] {
  const available = new Set(availableToolKeys);
  const sections: string[] = [];

  const traLoi = RULES_TRA_LOI.filter((r) => hopLe(r, available)).map((r) => r.text);
  if (traLoi.length > 0) sections.push(`Quy tắc dùng công cụ:\n${traLoi.join("\n")}`);

  if (available.size > 0) sections.push(KHOI_KE_TIEN_TRINH);

  const traCuu = RULES_TRA_CUU.filter((r) => hopLe(r, available)).map((r) => r.text);
  if (traCuu.length > 0) {
    sections.push(`Quy tắc tra cứu thông tin (làm đúng thứ tự, đừng bỏ cuộc sớm):\n${traCuu.join("\n")}`);
  }

  return sections;
}
