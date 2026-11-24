import { useEffect, useState } from "react";
import type { FacebookPageItem, ManagedAgent, VietQrAccountItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import {
  IconCheck,
  IconClose,
  IconGlobe,
  IconPlus,
  IconQrCode,
  IconTrash,
} from "../shared/dashboard-icons";
import { Badge, EmptyRow, O_GHIM_PHAI, TableShell } from "../shared/ui-bits";

const PLAN_PRICES: Record<string, { label: string; quota: string; price: number }> = {
  basic: { label: "Cơ Bản (2.000 tin/tháng)", quota: "2.000 tin", price: 199000 },
  pro: { label: "Chuyên Nghiệp (10.000 tin/tháng)", quota: "10.000 tin", price: 499000 },
  unlimited: { label: "Không Giới Hạn", quota: "Vô hạn", price: 999000 },
};

const TABLE_HEADERS = [
  "Fanpage",
  "Trạng thái",
  "Gói cước",
  "Agent phụ trách",
  "Tin nhắn đã dùng",
  "Hạn sử dụng",
  "Thao tác",
];

export function FacebookPagesPage() {
  const [pages, setPages] = useState<FacebookPageItem[]>([]);
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [bankAccounts, setBankAccounts] = useState<VietQrAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal Thêm Fanpage
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPage, setNewPage] = useState({
    pageId: "",
    pageName: "",
    accessToken: "",
    agentId: "",
    planName: "basic" as "basic" | "pro" | "unlimited",
    durationDays: 30,
  });
  const [addError, setAddError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal Gia hạn VietQR
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [billingPage, setBillingPage] = useState<FacebookPageItem | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro" | "unlimited">("basic");
  const [selectedDuration, setSelectedDuration] = useState<number>(30); // 30, 90, 180 ngày

  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = async () => {
    try {
      setIsLoading(true);
      const res = await api.facebook.pages();
      setPages(res.data);
    } catch {
      // Bỏ qua lỗi kết nối
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    reload();
    api.agentsAdmin
      .list()
      .then((d) => {
        setAgents(d.items);
        if (d.items[0]) {
          setNewPage((prev) => ({ ...prev, agentId: d.items[0].id }));
        }
      })
      .catch(() => {});

    api.vietqr
      .accounts()
      .then((d) => setBankAccounts(d.accounts))
      .catch(() => {});
  }, []);

  const openAddModal = () => {
    setNewPage({
      pageId: "",
      pageName: "",
      accessToken: "",
      agentId: agents[0]?.id ?? "cskh",
      planName: "basic",
      durationDays: 30,
    });
    setAddError("");
    setIsAddModalOpen(true);
  };

  const submitAddPage = async () => {
    if (!newPage.pageId.trim() || !newPage.pageName.trim() || !newPage.accessToken.trim()) {
      setAddError("Vui lòng điền đầy đủ Page ID, Tên Fanpage và Page Access Token");
      return;
    }
    setAddError("");
    setIsSubmitting(true);
    try {
      await api.facebook.createPage(newPage);
      setIsAddModalOpen(false);
      reload();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Lỗi khi thêm Fanpage";
      setAddError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (page: FacebookPageItem) => {
    const nextStatus = page.status === "active" ? "paused" : "active";
    await api.facebook.updatePage(page.pageId, { status: nextStatus });
    reload();
  };

  const openBillingModal = (page: FacebookPageItem) => {
    setBillingPage(page);
    setSelectedPlan(page.planName);
    setSelectedDuration(30);
    setIsBillingModalOpen(true);
  };

  const confirmExtension = async () => {
    if (!billingPage) return;
    await api.facebook.extendSubscription(billingPage.pageId, {
      additionalDays: selectedDuration,
      planName: selectedPlan,
    });
    setIsBillingModalOpen(false);
    reload();
  };

  const xoaPage = async (page: FacebookPageItem) => {
    const ok = await confirm({
      title: `Xóa Fanpage ${page.pageName}?`,
      message: `Hệ thống sẽ ngưng nhận tin nhắn từ Page ${page.pageId}. Dữ liệu lịch sử chat cũ vẫn được lưu.`,
    });
    if (!ok) return;
    await api.facebook.removePage(page.pageId);
    reload();
  };

  // Tính số tiền gia hạn
  const monthlyPrice = PLAN_PRICES[selectedPlan]?.price ?? 199000;
  const multiplier = selectedDuration === 90 ? 3 * 0.9 : selectedDuration === 180 ? 6 * 0.8 : 1;
  const finalPrice = Math.round((monthlyPrice * multiplier) / 1000) * 1000;

  // Lấy tài khoản ngân hàng nhận thanh toán (ưu tiên STK 6691916868 của Anh Khoa, hoặc tài khoản mặc định)
  const defaultBank =
    bankAccounts.find((b) => b.accountNumber === "6691916868") ??
    bankAccounts.find((b) => b.isDefault) ??
    bankAccounts[0];
  const memoText = billingPage ? `FB ${billingPage.pageId.slice(-6)} ${selectedPlan.toUpperCase()}` : "GIA HAN FB";
  const qrUrl = defaultBank
    ? `https://api.vietqr.io/image/${defaultBank.bankCode}-${defaultBank.accountNumber}-compact2.png?amount=${finalPrice}&addInfo=${encodeURIComponent(memoText)}&accountName=${encodeURIComponent(defaultBank.accountHolder)}`
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={IconGlobe}
        title="Quản Lý Fanpage & Gói Cước SaaS"
        subtitle="Kết nối đa Fanpage Facebook Messenger, phân quyền kịch bản Agent riêng biệt, kiểm soát hạn mức tin nhắn và gia hạn tự động qua VietQR."
        aside={
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zalo-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zalo-600 transition-colors"
          >
            <IconPlus size={16} />
            Thêm Fanpage
          </button>
        }
      />

      <TableShell headers={TABLE_HEADERS} ghimCotCuoi minWidth={850}>
        {pages.length === 0 ? (
          <EmptyRow
            colSpan={7}
            text={isLoading ? "Đang tải danh sách Fanpage..." : "Chưa có Fanpage nào được kết nối. Bấm 'Thêm Fanpage' để bắt đầu."}
          />
        ) : (
          pages.map((p) => {
            const percent =
              p.messagesQuota > 0 ? Math.min(100, Math.round((p.messagesUsed / p.messagesQuota) * 100)) : 0;
            const assignedAgent = agents.find((a) => a.id === p.agentId);

            return (
              <tr key={p.pageId} className="border-b border-line hover:bg-canvas-subtle/30 transition-colors">
                <td className="px-4 py-3.5">
                  <div className="font-medium text-ink flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold text-xs">
                      f
                    </span>
                    <div>
                      <div>{p.pageName}</div>
                      <div className="text-xs text-ink-soft">ID: {p.pageId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  {p.status === "active" ? (
                    <Badge tone="green">Đang chạy</Badge>
                  ) : p.status === "paused" ? (
                    <Badge tone="amber">Tạm dừng</Badge>
                  ) : (
                    <Badge tone="red">Hết hạn</Badge>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <span className="font-semibold text-ink uppercase text-xs tracking-wider">
                    {p.planName}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-ink-soft">
                  {assignedAgent ? (
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      <span>{assignedAgent.icon}</span> {assignedAgent.name}
                    </span>
                  ) : (
                    p.agentId
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <div className="w-32">
                    <div className="flex justify-between text-xs text-ink-soft mb-1">
                      <span>{p.messagesUsed.toLocaleString()} tin</span>
                      <span>{p.messagesQuota > 0 ? `${p.messagesQuota.toLocaleString()}` : "∞"}</span>
                    </div>
                    {p.messagesQuota > 0 && (
                      <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            percent > 90 ? "bg-red-500" : percent > 70 ? "bg-amber-500" : "bg-zalo-500"
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="text-sm text-ink">
                    {p.daysRemaining > 0 ? (
                      <span className={p.daysRemaining <= 3 ? "text-amber-600 font-medium" : ""}>
                        Còn {p.daysRemaining} ngày
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium">Đã hết hạn</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {new Date(p.cycleEndAt).toLocaleDateString("vi-VN")}
                  </div>
                </td>
                <td className={`px-4 py-3.5 text-right ${O_GHIM_PHAI}`}>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => toggleStatus(p)}
                      title={p.status === "active" ? "Tạm dừng" : "Tiếp tục chạy"}
                      className="rounded border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-subtle transition-colors"
                    >
                      {p.status === "active" ? "Tạm dừng" : "Kích hoạt"}
                    </button>
                    <button
                      onClick={() => openBillingModal(p)}
                      title="Gia hạn gói (VietQR)"
                      className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition-colors"
                    >
                      <IconQrCode size={13} />
                      Gia hạn
                    </button>
                    <button
                      onClick={() => xoaPage(p)}
                      title="Xóa Fanpage"
                      className="rounded p-1 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </TableShell>

      {/* MODAL THÊM FANPAGE */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl border border-line space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">Thêm Fanpage Mới</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1 text-ink-soft hover:bg-canvas-subtle transition-colors"
              >
                <IconClose size={18} />
              </button>
            </div>

            {addError && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 border border-red-200">
                {addError}
              </div>
            )}

            <div className="space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Page ID *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 1502969449561363"
                  value={newPage.pageId}
                  onChange={(e) => setNewPage({ ...newPage, pageId: e.target.value.trim() })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-hidden focus:border-zalo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Tên Fanpage *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Yagami Kitchen - Trà Đào & Ăn Vặt"
                  value={newPage.pageName}
                  onChange={(e) => setNewPage({ ...newPage, pageName: e.target.value })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-hidden focus:border-zalo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Page Access Token *</label>
                <textarea
                  rows={3}
                  placeholder="Dán mã EAA... dài hạn của Page từ Meta for Developers"
                  value={newPage.accessToken}
                  onChange={(e) => setNewPage({ ...newPage, accessToken: e.target.value.trim() })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink outline-hidden focus:border-zalo-500"
                />
                <span className="text-[11px] text-ink-soft">Token sẽ được mã hóa an toàn bằng chuẩn AES-256-GCM trong DB.</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-soft mb-1">Agent Phụ Trách</label>
                  <select
                    value={newPage.agentId}
                    onChange={(e) => setNewPage({ ...newPage, agentId: e.target.value })}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-hidden focus:border-zalo-500"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.icon} {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-soft mb-1">Gói Cước Ban Đầu</label>
                  <select
                    value={newPage.planName}
                    onChange={(e) => setNewPage({ ...newPage, planName: e.target.value as "basic" | "pro" | "unlimited" })}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-hidden focus:border-zalo-500"
                  >
                    <option value="basic">Gói Basic (2.000 tin)</option>
                    <option value="pro">Gói Pro (10.000 tin)</option>
                    <option value="unlimited">Gói Unlimited</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-medium text-ink-soft hover:bg-canvas-subtle transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={submitAddPage}
                className="rounded-lg bg-zalo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-zalo-600 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Đang kết nối..." : "Lưu & Kích hoạt Webhook"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GIA HẠN VIETQR BILLING */}
      {isBillingModalOpen && billingPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl border border-line space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Gia Hạn Fanpage: {billingPage.pageName}</h3>
                <p className="text-xs text-ink-soft">Quét mã VietQR chuyển khoản để gia hạn tự động</p>
              </div>
              <button
                onClick={() => setIsBillingModalOpen(false)}
                className="rounded-lg p-1 text-ink-soft hover:bg-canvas-subtle transition-colors"
              >
                <IconClose size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Chọn gói cước</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(["basic", "pro", "unlimited"] as const).map((pl) => (
                    <button
                      key={pl}
                      type="button"
                      onClick={() => setSelectedPlan(pl)}
                      className={`rounded-lg p-2.5 text-center font-medium border transition-colors ${
                        selectedPlan === pl
                          ? "border-zalo-500 bg-zalo-50 text-zalo-700 font-bold shadow-xs"
                          : "border-line text-ink hover:bg-canvas-subtle"
                      }`}
                    >
                      <div className="uppercase">{pl}</div>
                      <div className="text-[10px] text-ink-soft">{PLAN_PRICES[pl].quota}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">Thời gian gia hạn</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { days: 30, label: "1 Tháng" },
                    { days: 90, label: "3 Tháng (-10%)" },
                    { days: 180, label: "6 Tháng (-20%)" },
                  ].map((dur) => (
                    <button
                      key={dur.days}
                      type="button"
                      onClick={() => setSelectedDuration(dur.days)}
                      className={`rounded-lg p-2 text-center border transition-colors ${
                        selectedDuration === dur.days
                          ? "border-emerald-600 bg-emerald-50 text-emerald-800 font-bold"
                          : "border-line text-ink hover:bg-canvas-subtle"
                      }`}
                    >
                      {dur.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* KHUNG MÃ QR THANH TOÁN */}
              <div className="rounded-xl border border-line bg-canvas-subtle/50 p-4 text-center space-y-2">
                <div className="text-xs font-semibold text-ink-soft">MÃ QR CHUYỂN KHOẢN TỰ ĐỘNG</div>
                {qrUrl ? (
                  <div className="flex justify-center">
                    <img src={qrUrl} alt="VietQR" className="h-44 w-44 rounded-lg bg-white p-1 shadow-sm border border-line" />
                  </div>
                ) : (
                  <div className="py-6 text-xs text-ink-soft">Chưa cấu hình STK mặc định ở tab 'Tài khoản VietQR'</div>
                )}

                <div className="text-xs text-ink">
                  <div>Số tiền: <strong className="text-emerald-600 font-bold text-sm">{finalPrice.toLocaleString("vi-VN")} đ</strong></div>
                  <div>Nội dung: <code className="bg-canvas px-1.5 py-0.5 rounded font-mono font-bold text-ink">{memoText}</code></div>
                  <div className="text-[11px] text-ink-soft pt-1">Ngân hàng: {defaultBank?.bankName} - {defaultBank?.accountNumber} ({defaultBank?.accountHolder})</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setIsBillingModalOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-medium text-ink-soft hover:bg-canvas-subtle transition-colors"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={confirmExtension}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors shadow-xs"
              >
                <IconCheck size={14} />
                Xác nhận kích hoạt / Gia hạn
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
