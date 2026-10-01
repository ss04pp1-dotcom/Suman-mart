import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("customers.view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      addresses: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, orderNumber: true, status: true, paymentStatus: true, total: true, createdAt: true,
          items: { select: { name: true, quantity: true } },
        },
      },
      reviews: { orderBy: { createdAt: "desc" }, take: 10, select: { rating: true, comment: true, createdAt: true, product: { select: { name: true } } } },
    },
  });
  if (!customer) return fail("Customer not found", 404);

  // Only non-sensitive fields (no password hash exposure)
  const valid = customer.orders.filter((o) => o.status !== "CANCELLED");
  return ok({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl,
    createdAt: customer.createdAt,
    isActive: customer.isActive,
    addresses: customer.addresses,
    orders: customer.orders,
    reviews: customer.reviews,
    summary: {
      totalOrders: valid.length,
      totalSpent: valid.reduce((s, o) => s + o.total, 0),
      aov: valid.length ? Math.round(valid.reduce((s, o) => s + o.total, 0) / valid.length) : 0,
      lastOrderAt: valid.length ? valid[0].createdAt : null,
    },
  });
}
