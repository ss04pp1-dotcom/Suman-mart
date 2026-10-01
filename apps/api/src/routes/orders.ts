// POST /v1/orders/track — guest order tracking (Hono + Prisma port of
// apps/storefront/src/app/api/orders/track/route.ts; replaces the earlier
// raw-SQL port, whose dates serialized as epoch integers instead of the
// ISO strings the monolith produced).
//
// Privacy rule (unchanged): the order number AND the phone used at checkout
// must both match. Rate limited per IP (20 / 10 min — same as the monolith).

import { Hono } from "hono";
import type { Env } from "../env";
import { fail, ok } from "../lib/respond";
import { ipRateLimit } from "@/lib/rate-limit";
import { trackOrderSchema } from "@suman-mart/shared";
import { db } from "@/lib/db";

export const ordersApi = new Hono<{ Bindings: Env }>();

ordersApi.post("/track", async (c) => {
  const rl = await ipRateLimit("trackorder", 20, 10 * 60_000, c.req.raw);
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

  const order = await db.order.findUnique({
    where: { orderNumber },
    include: {
      items: { select: { name: true, imageUrl: true, quantity: true, total: true, options: true } },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { status: true, note: true, createdAt: true } },
    },
  });

  if (!order || !order.customerPhone.endsWith(phone.slice(-10))) {
    // Same message for missing order and wrong phone — no order enumeration.
    return fail(c, "No order found with this number and phone combination", 404, "NOT_FOUND");
  }

  return ok(c, {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    total: order.total,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    courier: order.courier,
    trackingNumber: order.trackingNumber,
    estimatedDelivery: order.estimatedDelivery,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({
      name: i.name,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      total: i.total,
      options: i.options ? (JSON.parse(i.options) as Record<string, string> | null) : null,
    })),
    statusHistory: order.statusHistory.map((h) => ({
      status: h.status,
      note: h.note,
      createdAt: h.createdAt,
    })),
  });
});
