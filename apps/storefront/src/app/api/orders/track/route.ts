import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { parseJSON } from "@/lib/json";
import { ipRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rl = await ipRateLimit("trackorder", 20, 10 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = (await req.json().catch(() => null)) as { orderNumber?: string; phone?: string };
  const orderNumber = body?.orderNumber?.trim().toUpperCase();
  const phone = body?.phone?.trim();
  if (!orderNumber || !phone) return fail("Order number and phone number are required", 422);

  const order = await db.order.findUnique({
    where: { orderNumber },
    include: {
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      supplierOrders: true,
    },
  });

  // Privacy: order number AND the phone used at checkout must both match
  if (!order || !order.customerPhone.endsWith(phone.slice(-10))) {
    return fail("No order found with this number and phone combination", 404);
  }

  return ok({
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
      options: parseJSON<Record<string, string> | null>(i.options, null),
    })),
    statusHistory: order.statusHistory.map((h) => ({
      status: h.status,
      note: h.note,
      createdAt: h.createdAt,
    })),
  });
}
