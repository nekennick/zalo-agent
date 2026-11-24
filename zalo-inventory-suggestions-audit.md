# Rà soát luồng gợi ý nhập hàng từ Zalo

Phạm vi từ tin báo nhận ở `D:/Github/zalo-agent` đến phiếu nhập ở `D:/Github/YagamiDashboard`. Kiểm tra Git cho thấy cơ chế đọc tin đến giữa lượt đã có từ `d700a85`, được sửa tiếp ở `74b838c` và `0f998c0`. Các file lõi nhập hàng đang ở worktree, nên thứ tự của phần chưa commit được xác định qua mã hiện tại, tài liệu bàn giao và bản chạy thực tế. Trên DB live đã có cột nguồn tin và cột học lựa chọn. Prisma ghi nhận migration nguồn tin, lịch sử migration học lựa chọn cần đối chiếu trước lần triển khai tiếp theo.

Luồng đề xuất là **tin gốc → dòng hàng chuẩn → gợi ý mã → duyệt → lưu phiếu**. Mã tin và vị trí dòng định danh bản ghi. Bộ ghép mã và dữ liệu học thêm đề xuất vào dòng đã có. Quyết định duyệt và số lượng tính theo đơn vị KiotViet được xác thực ở Dashboard.

## Thứ tự thực hiện

- [x] **P0 · Nguồn tin và bộ tách.** Lượt 305 mở với ảnh. AI đọc đủ ba món từ tin đến sau, còn tool thiếu tin đó. Dùng nguồn của cả lượt, ghép tên và lượng trên cùng dòng, giữ đơn vị từ tin gốc. Bộ tách chung đọc được `20th` và giữ `kg`. Ký hiệu mơ hồ như `b` được giữ nguyên để xác nhận.
- [x] **P0 · Ghép mã và chặn lệch đơn vị.** Tên hoặc mã phải khớp trước khi xét ngữ cảnh cùng tin. Mã đồng hạng cần chọn. Dashboard kiểm tra mã active và đơn vị ở cả giao diện lẫn API duyệt. Ca `CM` tính theo `Hộp` bị chặn khi tin báo `20 thùng`. Lựa chọn sai đơn vị bị loại khỏi lịch sử học. API chỉ đánh dấu **Đã nhập** khi nhận đúng thao tác.
- [x] **P0 · Đối soát tin trong lượt.** Bot kiểm tra từng mã tin. Nếu tool chỉ lưu một phần, bộ dự phòng gửi lại các dòng đã tách theo tên và lượng gốc để Dashboard chống trùng. Chỉ xác nhận khi Dashboard báo đủ số dòng đã tách và tin còn hiệu lực.
- [ ] **P1 · Hàng đợi và quy đổi.** Lưu bền trạng thái gửi để thử lại sau khi Dashboard mất kết nối hoặc bot khởi động lại. Dùng vị trí dòng ổn định cho biên nhận và đưa dòng mơ hồ vào hàng chờ kiểm tra. Khi hỗ trợ quy đổi, lưu riêng lượng/đơn vị báo, lượng/đơn vị nhập và hệ số được xác nhận.
- [ ] **P1 · Vòng đời phiếu và học lựa chọn.** Hiện **Đưa vào phiếu nhập** đánh dấu gợi ý đã duyệt trước khi phiếu được lưu. Chỉ giữ chỗ khi tạo được phiếu tạm và kiểm tra lại nguồn, phiên bản dòng khi lưu. Chốt đã nhập và ghi phản hồi học sau khi lưu phiếu thành công. **Đã nhập** xác nhận đã tự xử lý, **Bỏ qua** loại khỏi danh sách.
- [ ] **P1 · Phục hồi và triển khai.** Tin `8520783150030` có các dòng `77`, `78` đã chuyển sang `APPROVED`. Đối chiếu phiếu thực tế trước khi làm bất kỳ thao tác phục hồi nào. Kiểm tra lại lịch sử Prisma, bản build và các thay đổi cùng nhánh trước khi cập nhật live.
- [ ] **Nghiệm thu đợt tiếp theo.** Bổ sung kiểm thử Dashboard mất kết nối rồi khôi phục, bot restart lúc còn dòng chưa gửi, bỏ phiếu chưa lưu và hai người mở cùng một gợi ý. Đối chiếu số dòng, đơn vị, số lượng sau quy đổi và trạng thái tin nguồn trên DB riêng.

**Kiểm chứng bản sửa hiện tại.** 88 test bot liên quan và 20 test PostgreSQL Dashboard đã qua. Hai build, kiểm tra TypeScript và lint các file Dashboard đã qua. Phát lại qua API trên DB riêng tạo đúng ba dòng khi gửi một phần rồi gửi lại. Thu hồi loại tin cũ, tin gửi mới tạo đúng ba dòng mới. Bộ test bot toàn repo còn 5 lỗi, gồm lỗi cấu hình và một assertion ở bộ test tra web.
