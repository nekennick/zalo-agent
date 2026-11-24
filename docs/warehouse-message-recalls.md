# Tin nhận hàng bị thu hồi

Bot gắn `sourceAccountId`, `threadId`, `sourceMessageId` và `sourceCliMsgId` vào từng món gửi sang YagamiDashboard. Mã nguồn lấy từ tin thực tế của từng món trong batch, không lấy từ nội dung AI tự khai.

Khi nhóm kho có sự kiện `undo`, mã tin bị thu hồi lấy từ `event.data.content.globalMsgId`. Bot lưu dấu thu hồi vào SQLite trước khi gửi `PATCH /api/purchase-orders/zalo-pending` với `action: "RECALL_SOURCE"`. Nếu dashboard chưa xác nhận, hàng đợi bền thử lại mỗi 15 giây, kể cả sau khi khởi động lại bot. Tool AI và đường dự phòng đều kiểm tra dấu thu hồi trước khi gửi gợi ý.

Dashboard lưu nguồn trong `ZaloInventoryMessage`. Thu hồi chỉ đổi các mục `PENDING` của đúng nguồn sang `RECALLED`. Các mục `ALREADY_IMPORTED` (người dùng xác nhận đã tự nhập thủ công), `APPROVED`, `DISMISSED` giữ nguyên và vẫn liên kết nguồn để tra cứu. Sự kiện thu hồi không sửa phiếu nhập hoặc tồn kho.

Tin gửi lại có mã mới, được phân tích thành gợi ý mới. Gửi lặp cùng mã tin và cùng dòng hàng không tạo thêm bản ghi. Các tin khác mã dù cùng nội dung vẫn là các báo nhận hàng riêng. Dashboard kiểm tra nguồn còn hiệu lực trong giao dịch khi duyệt; giao diện chỉ cộng vào phiếu sau khi server duyệt thành công. Danh sách đang mở tự làm mới mỗi 5 giây, giữ lựa chọn và mã hàng người dùng đã chọn.

## Cập nhật dịch vụ

1. Ở repo YagamiDashboard, áp migration `20261123000000_zalo_inventory_message_sources` trước khi chạy dashboard mới, rồi generate Prisma client và build/restart dịch vụ dashboard.
2. Build/restart zalo-agent sau dashboard. SQLite tự tạo bảng nguồn khi khởi động; hàng đợi thu hồi chưa gửi tiếp tục được xử lý.
3. Kiểm tra bằng một báo nhận hàng thử: tạo gợi ý, thu hồi, gửi lại. Chỉ gợi ý từ tin mới còn trong danh sách chờ. Không bấm duyệt tạo phiếu thật để thử luồng thu hồi.

Các bản ghi có trước bản cập nhật chưa có mã nguồn không được tự ghép/xóa bằng tên hàng, số lượng hoặc thời gian. Cần đối chiếu thủ công các dòng cũ. Sự kiện thu hồi bot bỏ lỡ trong lúc tắt/mất kết nối vẫn là giới hạn của kênh nhận tin hiện tại.

## Kiểm chứng

- Bot: `pnpm typecheck`, `pnpm build`; test `src/inventory/inventory-recall.test.ts` cùng các test nhận tin, batch, lịch sử và chế độ chỉ đọc.
- Dashboard: `npx tsc --noEmit`, ESLint các file thay đổi, `next build`.
- Test PostgreSQL riêng: đặt `ZALO_PENDING_TEST_DATABASE_URL` trỏ tới database có tên bắt đầu bằng `codex_zalo_recall_test_`, tạo schema từ Prisma rồi chạy `vitest run lib/zalo-pending-imports.test.ts`. Không trỏ test vào database kho thật.
