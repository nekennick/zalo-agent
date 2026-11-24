import type { DatabaseSync } from "node:sqlite";
import { env } from "../config/env.js";
import { encryptSecret } from "../config/secret-cipher.js";

/**
 * Khởi tạo bảng lưu trữ đa Fanpage (Multi-tenant SaaS) và hạn mức gói cước.
 */
export function taoBangFacebookTenant(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_pages (
      page_id TEXT PRIMARY KEY,
      page_name TEXT NOT NULL,
      access_token TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
      plan_name TEXT NOT NULL DEFAULT 'basic' CHECK (plan_name IN ('basic', 'pro', 'unlimited')),
      messages_quota INTEGER NOT NULL DEFAULT 2000,
      messages_used INTEGER NOT NULL DEFAULT 0,
      cycle_start_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      cycle_end_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_facebook_pages_status ON facebook_pages (status);
  `);

  // Tự động seed Fanpage từ biến môi trường nếu có (đảm bảo tương thích ngược 100%)
  if (env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    const existing = db.prepare("SELECT page_id FROM facebook_pages WHERE page_id = ?").get(env.FACEBOOK_PAGE_ID);
    if (!existing) {
      const now = new Date();
      const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const defaultAgentId = "cskh";

      db.prepare(`
        INSERT INTO facebook_pages (
          page_id,
          page_name,
          access_token,
          agent_id,
          status,
          plan_name,
          messages_quota,
          messages_used,
          cycle_start_at,
          cycle_end_at
        ) VALUES (?, ?, ?, ?, 'active', 'pro', 10000, 0, ?, ?)
      `).run(
        env.FACEBOOK_PAGE_ID,
        "Zalo Agent (Mặc định)",
        encryptSecret(env.FACEBOOK_PAGE_ACCESS_TOKEN),
        defaultAgentId,
        now.toISOString(),
        thirtyDaysLater,
      );
    }
  }
}
