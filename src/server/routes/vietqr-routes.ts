import { Hono } from "hono";
import { z } from "zod";
import { VIETQR_BANKS } from "../../conversation/vietqr-banks.js";
import {
  createVietQrAccount,
  deleteVietQrAccount,
  listVietQrAccounts,
  updateVietQrAccount,
} from "../../conversation/vietqr-bank-store.js";

const accountInputSchema = z.object({
  bankCode: z.string().min(1, "Mã ngân hàng không được để trống"),
  bankName: z.string().min(1, "Tên ngân hàng không được để trống"),
  accountNumber: z.string().min(1, "Số tài khoản không được để trống"),
  accountHolder: z.string().min(1, "Tên chủ tài khoản không được để trống"),
  nickname: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const vietQrRoutes = new Hono()
  .get("/banks", (c) => {
    return c.json({ banks: VIETQR_BANKS });
  })

  .get("/accounts", (c) => {
    return c.json({ accounts: listVietQrAccounts() });
  })

  .post("/accounts", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = accountInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" }, 400);
    }

    const created = createVietQrAccount(parsed.data);
    return c.json({ ok: true, account: created }, 201);
  })

  .patch("/accounts/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = accountInputSchema.partial().safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" }, 400);
    }

    const ok = updateVietQrAccount(id, parsed.data);
    if (!ok) return c.json({ error: "Tài khoản không tồn tại" }, 404);
    return c.json({ ok: true });
  })

  .delete("/accounts/:id", (c) => {
    const id = c.req.param("id");
    const ok = deleteVietQrAccount(id);
    if (!ok) return c.json({ error: "Tài khoản không tồn tại" }, 404);
    return c.json({ ok: true });
  });
