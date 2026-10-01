import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, pageParams, paginated } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);

  const url = new URL(req.url);
  const { page, limit, skip, take } = pageParams(url, 10);

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        items: { select: { name: true, imageUrl: true, quantity: true, total: true } },
      },
    }),
    db.order.count({ where: { customerId: customer.id } }),
  ]);

  return ok(
    paginated(
      orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        createdAt: o.createdAt,
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
        firstItems: o.items.slice(0, 3),
      })),
      total,
      page,
      limit
    )
  );
}
