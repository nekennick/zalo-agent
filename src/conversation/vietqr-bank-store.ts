import crypto from "node:crypto";
import { db } from "./database.js";

export type VietQrAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  nickname: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  nickname: string;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function rowToAccount(r: DbRow): VietQrAccount {
  return {
    id: r.id,
    bankCode: r.bank_code,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    accountHolder: r.account_holder,
    nickname: r.nickname,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listVietQrAccounts(): VietQrAccount[] {
  const rows = db
    .prepare("SELECT * FROM vietqr_bank_accounts ORDER BY is_default DESC, created_at ASC")
    .all() as unknown as DbRow[];
  return rows.map(rowToAccount);
}

export function getVietQrAccount(id: string): VietQrAccount | null {
  const row = db.prepare("SELECT * FROM vietqr_bank_accounts WHERE id = ?").get(id) as DbRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getDefaultVietQrAccount(): VietQrAccount | null {
  const row = db
    .prepare("SELECT * FROM vietqr_bank_accounts WHERE is_default = 1 LIMIT 1")
    .get() as DbRow | undefined;
  if (row) return rowToAccount(row);

  // Fallback: Lấy tài khoản đầu tiên nếu chưa có mặc định
  const first = db
    .prepare("SELECT * FROM vietqr_bank_accounts ORDER BY created_at ASC LIMIT 1")
    .get() as DbRow | undefined;
  return first ? rowToAccount(first) : null;
}

export function createVietQrAccount(params: {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  nickname?: string;
  isDefault?: boolean;
}): VietQrAccount {
  const id = `vqr-${crypto.randomUUID().slice(0, 8)}`;
  const isDefault = params.isDefault ? 1 : 0;

  if (isDefault === 1) {
    db.prepare("UPDATE vietqr_bank_accounts SET is_default = 0").run();
  }

  const holder = params.accountHolder.trim().toUpperCase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO vietqr_bank_accounts (id, bank_code, bank_name, account_number, account_holder, nickname, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.bankCode.trim(),
    params.bankName.trim(),
    params.accountNumber.trim(),
    holder,
    (params.nickname ?? "").trim(),
    isDefault,
    now,
    now,
  );

  return {
    id,
    bankCode: params.bankCode.trim(),
    bankName: params.bankName.trim(),
    accountNumber: params.accountNumber.trim(),
    accountHolder: holder,
    nickname: (params.nickname ?? "").trim(),
    isDefault: isDefault === 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateVietQrAccount(
  id: string,
  params: {
    bankCode?: string;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
    nickname?: string;
    isDefault?: boolean;
  },
): boolean {
  const existing = getVietQrAccount(id);
  if (!existing) return false;

  if (params.isDefault === true) {
    db.prepare("UPDATE vietqr_bank_accounts SET is_default = 0").run();
  }

  const next = {
    bankCode: params.bankCode?.trim() ?? existing.bankCode,
    bankName: params.bankName?.trim() ?? existing.bankName,
    accountNumber: params.accountNumber?.trim() ?? existing.accountNumber,
    accountHolder: params.accountHolder?.trim().toUpperCase() ?? existing.accountHolder,
    nickname: params.nickname !== undefined ? params.nickname.trim() : existing.nickname,
    isDefault: params.isDefault !== undefined ? (params.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
  };

  const res = db
    .prepare(`
      UPDATE vietqr_bank_accounts
      SET bank_code = ?, bank_name = ?, account_number = ?, account_holder = ?,
          nickname = ?, is_default = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `)
    .run(next.bankCode, next.bankName, next.accountNumber, next.accountHolder, next.nickname, next.isDefault, id);

  return res.changes > 0;
}

export function deleteVietQrAccount(id: string): boolean {
  const res = db.prepare("DELETE FROM vietqr_bank_accounts WHERE id = ?").run(id);
  return res.changes > 0;
}

function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function stripHonorific(s: string): string {
  return s.replace(/^(anh|chi|em|ban|bac|chu|co|di|a|c|e)\s+/i, "").trim();
}

/**
 * Tìm tài khoản ngân hàng khớp với tên/biệt danh người nhận (ví dụ "Dung", "Chị Dung", "Phan Dũng", "Phan Thanh Dung").
 */
export function findVietQrAccountByKeyword(keyword: string): VietQrAccount | null {
  const q = normalizeStr(keyword);
  if (!q) return null;

  const qClean = stripHonorific(q);
  const tokens = (qClean || q).split(/\s+/).filter(Boolean);
  const accounts = listVietQrAccounts();

  // 1. Khớp chính xác hoặc chuỗi con liên tiếp với nickname
  for (const acc of accounts) {
    if (acc.nickname) {
      const parts = acc.nickname.split(/[,;\n]/).map((p) => normalizeStr(p)).filter(Boolean);
      if (
        parts.some(
          (p) =>
            p === q ||
            (qClean && p === qClean) ||
            (qClean && stripHonorific(p) === qClean) ||
            q.includes(p) ||
            p.includes(q) ||
            (qClean && (qClean.includes(p) || p.includes(qClean))),
        )
      ) {
        return acc;
      }
    }
  }

  // 2. Khớp chuỗi con liên tiếp theo tên chủ tài khoản
  for (const acc of accounts) {
    const holderNorm = normalizeStr(acc.accountHolder);
    if (
      holderNorm.includes(q) ||
      (qClean && holderNorm.includes(qClean)) ||
      q.includes(holderNorm)
    ) {
      return acc;
    }
  }

  // 3. Khớp từ phân tách (Token matching: ví dụ "Phan Dũng" khớp "PHAN THANH DUNG")
  if (tokens.length >= 2) {
    for (const acc of accounts) {
      const holderTokens = normalizeStr(acc.accountHolder).split(/\s+/).filter(Boolean);
      if (tokens.every((t) => holderTokens.includes(t))) {
        return acc;
      }
      if (acc.nickname) {
        const parts = acc.nickname.split(/[,;\n]/).map((p) => normalizeStr(p));
        for (const p of parts) {
          const pTokens = p.split(/\s+/).filter(Boolean);
          if (tokens.every((t) => pTokens.includes(t))) {
            return acc;
          }
        }
      }
    }
  } else if (tokens.length === 1) {
    // Tìm theo 1 từ đơn (ví dụ "Dũng" khớp với tên gọi cuối cùng trong "PHAN THANH DUNG")
    const singleToken = tokens[0];
    for (const acc of accounts) {
      const holderTokens = normalizeStr(acc.accountHolder).split(/\s+/).filter(Boolean);
      const lastName = holderTokens[holderTokens.length - 1];
      if (lastName === singleToken) {
        return acc;
      }
    }
  }

  // 4. Khớp theo id
  const byId = accounts.find((a) => a.id.toLowerCase() === q);
  if (byId) return byId;

  return null;
}
