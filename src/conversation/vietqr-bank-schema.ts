import type { DatabaseSync } from "node:sqlite";

/**
 * Khởi tạo bảng lưu các tài khoản ngân hàng nhận thanh toán VietQR.
 * Có seed sẵn tài khoản mẫu của chị Phan Thanh Dung (VietinBank).
 */
export function taoBangVietQrBank(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vietqr_bank_accounts (
      id TEXT PRIMARY KEY,
      bank_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vietqr_bank_accs_default ON vietqr_bank_accounts (is_default);
  `);

  // Seed tài khoản mẫu nếu bảng chưa có dòng nào
  const countRow = db.prepare("SELECT COUNT(*) AS total FROM vietqr_bank_accounts").get() as {
    total: number;
  };
  if (countRow.total === 0) {
    db.prepare(`
      INSERT INTO vietqr_bank_accounts (id, bank_code, bank_name, account_number, account_holder, nickname, is_default)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      "acc-dung",
      "vietinbank",
      "VietinBank",
      "107001620872",
      "PHAN THANH DUNG",
      "Anh Dũng, Dũng, Phan Dũng, Thanh Dũng, Phan Thanh Dũng, Chị Dung",
    );
  }
}
