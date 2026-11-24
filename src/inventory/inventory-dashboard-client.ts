export const YAGAMI_DASHBOARD_PENDING_URL =
  process.env.YAGAMI_DASHBOARD_PENDING_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://host.docker.internal:3000/api/purchase-orders/zalo-pending"
    : "http://127.0.0.1:3000/api/purchase-orders/zalo-pending");

export async function sendInventoryDashboard(body: unknown, method = "POST"): Promise<boolean> {
  return (await postInventoryDashboard(body, method)).success;
}

export async function postInventoryDashboard(body: unknown, method = "POST"): Promise<{ success: boolean; count?: number }> {
  const res = await fetch(YAGAMI_DASHBOARD_PENDING_URL, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json() as { success?: boolean; count?: number };
  return { success: res.ok && data.success === true, count: data.count };
}
