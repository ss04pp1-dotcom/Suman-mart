// POST /v1/orders/track — guest order tracking (D1 port of
// apps/storefront/src/app/api/orders/track/route.ts).
//
// Privacy rule (unchanged): the order number AND the phone used at checkout
// must both match. Rate limited per IP (20 / 10 min — same as the monolith).

import { Hono } from "hono";
import type { Env } from "../env";
import { fail, ok } from "../lib/respond";
import { parseJSON } from "../lib/d1";
import { clientIp, rateLimit } from "../lib/rate-limit";
import { trackOrderSchema } from "@suman-mart/shared";

export const ordersApi = new Hono<{ Bindings: Env }>();

ordersApi.post("/track", async (c) => {
  const rl = await rateLimit(c.env, "trackorder", clientIp(c.req.raw), 20, 10 * 60_000);
  if (!rl.ok) {
    return fail(c, "Too many attempts. Please try again later.", 429, "RATE_LIMITED");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = trackOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, "Order number and phone number are required", 422, "VALIDATION_ERROR");
  }

  const orderNumber = parsed.data.orderNumber.toUpperCase();
  const phone = parsed.data.phone;

  const order = await c.env.DB.prepare(
    `SELECT "id", "orderNumber", "status", "paymentStatus", "paymentMethod", "total", "subtotal",
            "discountTotal", "shippingTotal", "courier", "trackingNumber", "estimatedDelivery",
            "createdAt", "customerPhone"
     FROM "Order" WHERE "orderNumber" = ?`
  )
    .bind(orderNumber)
    .first<Record<string, unknown>>();

  if (!order || !String(order.customerPhone).endsWith(phone.slice(-10))) {
    // Same message for missing order and wrong phone — no order enumeration.
    return fail(c, "No order found with this number and phone combination", 404, "NOT_FOUND");
  }

  const [itemsRes, historyRes] = await Promise.all([
    c.env.DB.prepare(
      // No explicit ordering — natural row order, same as the monolith's
      // unordered Prisma include (OrderItem has no createdAt column).
      `SELECT "name", "imageUrl", "quantity", "total", "options"
       FROM OrderItem WHERE "orderId" = ?`
    )
      .bind(order.id)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT "status", "note", "createdAt" FROM OrderStatusHistory
       WHERE "orderId" = ? ORDER BY "createdAt" ASC, "id" ASC`
    )
      .bind(order.id)
      .all<Record<string, unknown>>(),
  ]);

  return ok(c, {
    orderNumber: String(order.orderNumber),
    status: String(order.status),
    paymentStatus: String(order.paymentStatus),
    paymentMethod: String(order.paymentMethod),
    total: Number(order.total),
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    shippingTotal: Number(order.shippingTotal),
    courier: order.courier == null ? null : String(order.courier),
    trackingNumber: order.trackingNumber == null ? null : String(order.trackingNumber),
    estimatedDelivery: order.estimatedDelivery,
    createdAt: order.createdAt,
    items: (itemsRes.results ?? []).map((i) => ({
      name: String(i.name),
      imageUrl: i.imageUrl == null ? null : String(i.imageUrl),
      quantity: Number(i.quantity),
      total: Number(i.total),
      options: parseJSON<Record<string, string> | null>(i.options, null),
    })),
    statusHistory: (historyRes.results ?? []).map((h) => ({
      status: String(h.status),
      note: h.note == null ? null : String(h.note),
      createdAt: h.createdAt,
    })),
  });
});
