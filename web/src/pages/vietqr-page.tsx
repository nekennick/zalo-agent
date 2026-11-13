import { useEffect, useState } from "react";
import type { VietQrAccountItem, VietQrBank } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconPencil, IconPlus, IconQrCode, IconTrash } from "../shared/dashboard-icons";
import { EmptyRow, TableShell } from "../shared/ui-bits";

export function VietQrPage() {
  const [accounts, setAccounts] = useState<VietQrAccountItem[]>([]);
  const [banks, setBanks] = useState<VietQrBank[]>([]);
  const [editing, setEditing] = useState<Partial<VietQrAccountItem> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = () => {
    api.vietqr.accounts().then((d) => setAccounts(d.accounts)).catch(() => {});
  };

  useEffect(() => {
    reload();
    api.vietqr.banks().then((d) => setBanks(d.banks)).catch(() => {});
  }, []);

  const openAdd = () => {
    setEditing({ bankCode: banks[0]?.code ?? "vietinbank", bankName: banks[0]?.shortName ?? "VietinBank", isDefault: false });
    setIsModalOpen(true);
  };

  const openEdit = (acc: VietQrAccountItem) => {
    setEditing({ ...acc });
    setIsModalOpen(true);
  };

  const save = async () => {
    if (!editing || !editing.accountNumber || !editing.accountHolder || !editing.bankCode) return;
    const selectedBank = banks.find((b) => b.code === editing.bankCode);
    const bankName = selectedBank?.shortName ?? editing.bankName ?? editing.bankCode;

    if (editing.id) {
      await api.vietqr.updateAccount(editing.id, { ...editing, bankName });
    } else {
      await api.vietqr.createAccount({
        bankCode: editing.bankCode,
        bankName,
        accountNumber: editing.accountNumber,
        accountHolder: editing.accountHolder,
        nickname: editing.nickname,
        isDefault: editing.isDefault,
      });
    }
    setIsModalOpen(false);
    reload();
  };

  const xoa = async (acc: VietQrAccountItem) => {
    const ok = await confirm({
      title: `Xóa tài khoản ${acc.accountHolder}?`,
      message: `Xóa số tài khoản ${acc.accountNumber} (${acc.bankName}). Không hoàn tác được.`,
    });
    if (!ok) return;
    await api.vietqr.deleteAccount(acc.id);
    reload();
  };

  const toggleDefault = async (acc: VietQrAccountItem) => {
    if (acc.isDefault) return;
    await api.vietqr.updateAccount(acc.id, { isDefault: true });
    reload();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <PageHeader icon={IconQrCode} title="Tài khoản VietQR" subtitle="Quản lý tài khoản ngân hàng nhận thanh toán khi đặt món/ăn uống nhóm" />
        <button onClick={openAdd} className="flex items-center gap-1.5 rounded-lg bg-zalo-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zalo-700">
          <IconPlus className="h-4 w-4" /> Thêm tài khoản
        </button>
      </div>

      <TableShell headers={["Ngân hàng", "Số tài khoản", "Tên chủ tài khoản", "Biệt danh / Người nhận", "Mặc định", ""]}>
        {accounts.length === 0 && <EmptyRow colSpan={6} text="Chưa có tài khoản VietQR nào" />}
        {accounts.map((a) => (
          <tr key={a.id} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="px-4 py-3 font-medium text-ink">{a.bankName}</td>
            <td className="px-4 py-3 font-mono text-ink-soft">{a.accountNumber}</td>
            <td className="px-4 py-3 font-semibold text-ink">{a.accountHolder}</td>
            <td className="px-4 py-3 text-ink-soft">{a.nickname || "-"}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => toggleDefault(a)}
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${a.isDefault ? "bg-emerald-500/15 text-emerald-600" : "bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-700"}`}
              >
                {a.isDefault ? "Mặc định" : "Đặt mặc định"}
              </button>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => openEdit(a)} className="rounded-lg p-1.5 text-ink-soft hover:bg-tile" title="Sửa"><IconPencil className="h-4 w-4" /></button>
                <button onClick={() => xoa(a)} className="rounded-lg p-1.5 text-ink-soft hover:bg-red-500/10 hover:text-red-500" title="Xóa"><IconTrash className="h-4 w-4" /></button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {isModalOpen && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
            <h3 className="text-[17px] font-semibold text-ink">{editing.id ? "Sửa tài khoản VietQR" : "Thêm tài khoản VietQR"}</h3>
            <div className="mt-4 space-y-3.5 text-[13px]">
              <div>
                <label className="mb-1 block font-medium text-ink-soft">Ngân hàng</label>
                <select
                  value={editing.bankCode ?? ""}
                  onChange={(e) => setEditing({ ...editing, bankCode: e.target.value })}
                  className="w-full rounded-lg border border-line bg-tile px-3 py-2 text-ink focus:border-zalo-500 focus:outline-none"
                >
                  {banks.map((b) => <option key={b.code} value={b.code}>{b.shortName} - {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-ink-soft">Số tài khoản</label>
                <input
                  type="text"
                  value={editing.accountNumber ?? ""}
                  onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                  placeholder="Ví dụ: 107001620872"
                  className="w-full rounded-lg border border-line bg-tile px-3 py-2 font-mono text-ink focus:border-zalo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-ink-soft">Tên chủ tài khoản (viết hoa không dấu)</label>
                <input
                  type="text"
                  value={editing.accountHolder ?? ""}
                  onChange={(e) => setEditing({ ...editing, accountHolder: e.target.value.toUpperCase() })}
                  placeholder="Ví dụ: PHAN THANH DUNG"
                  className="w-full rounded-lg border border-line bg-tile px-3 py-2 text-ink focus:border-zalo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-ink-soft">Tên gọi / Biệt danh (để bot nhận diện)</label>
                <input
                  type="text"
                  value={editing.nickname ?? ""}
                  onChange={(e) => setEditing({ ...editing, nickname: e.target.value })}
                  placeholder="Ví dụ: Dung, Chị Dung, Thanh Dung"
                  className="w-full rounded-lg border border-line bg-tile px-3 py-2 text-ink focus:border-zalo-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-ink-soft">Nhập các cách gọi cách nhau bằng dấu phẩy để bot hiểu khi mọi người nhắn tên.</p>
              </div>
              <label className="flex items-center gap-2 pt-1 font-medium text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(editing.isDefault)}
                  onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
                  className="rounded border-line"
                />
                Đặt làm tài khoản nhận mặc định
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2.5">
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-tile">Hủy</button>
              <button onClick={save} className="rounded-lg bg-zalo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-zalo-700">Lưu tài khoản</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
