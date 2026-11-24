# Xử lý tin nhận hàng bị thu hồi

- [x] Lưu mã tin nguồn và dấu thu hồi bền; nối sự kiện `undo` cho nhóm kho.
- [x] Gửi mã nguồn từng món ở cả tool AI và đường dự phòng; chặn tin đã thu hồi, thử lại thông báo khi dashboard mất kết nối.
- [x] Nối YagamiDashboard: lưu nguồn, vô hiệu hóa mục còn chờ, chống tạo lại mục đã thu hồi và chống gửi lặp.
- [x] Làm mới danh sách đang mở, kiểm tra nguồn khi duyệt; giữ nguyên thao tác xác nhận nhập thủ công.
- [x] Kiểm chứng ca 324,5 kg, thu hồi giữa lượt, gửi lặp, khởi động lại và các mục đã xử lý; chạy kiểm tra kiểu/build liên quan.

Không tự đánh dấu “Đã nhập”, không sửa phiếu nhập hoặc tồn kho từ sự kiện thu hồi. Hai repo đang có thay đổi sẵn, cần giữ nguyên.

Kiểm chứng: 131 test bot, 13 test PostgreSQL và kiểm tra HTTP trên server riêng đều qua; TypeScript, lint các file dashboard thay đổi và build hai dự án đều qua. Migration đã thử trên cả schema mới và schema có dữ liệu cũ. Bộ test rộng dashboard có 1 lỗi ngoài phạm vi: bộ lọc Nhi trả đơn vị Bao, test chờ Bịch.

Chưa áp migration vào database kho thật hoặc khởi động lại các container đang chạy. Quy trình áp dụng nằm ở `docs/warehouse-message-recalls.md`.
