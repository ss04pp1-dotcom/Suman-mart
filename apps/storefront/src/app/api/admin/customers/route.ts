import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("customers.view");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const { page, limit, skip, take } = pageParams(url, 15);
  const q = url.searchParams.get("q")?.trim();

  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] }
    : {};

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, name: true, email: true, phone: true, createdAt: true, isActive: true,
        orders: { select: { total: true, createdAt: true, status: true } },
      },
    }),
    db.customer.count({ where }),
  ]);

  return ok(
    paginated(
      customers.map((c) => {
        const valid = c.orders.filter((o) => o.status !== "CANCELLED");
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          createdAt: c.createdAt,
          isActive: c.isActive,
          totalOrders: valid.length,
          totalSpent: valid.reduce((s, o) => s + o.total, 0),
          lastOrderAt: valid.length ? valid.map((o) => o.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] : null,
        };
      }),
      total,
      page,
      limit
    )
  );
}
