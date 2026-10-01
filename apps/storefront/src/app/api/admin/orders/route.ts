import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("orders.view");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const { page, limit, skip, take } = pageParams(url, 15);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const customer = url.searchParams.get("customer")?.trim();
  const supplier = url.searchParams.get("supplier");

  const where: Prisma.OrderWhereInput = {
    ...(q ? { OR: [{ orderNumber: { contains: q.toUpperCase() } }, { customerName: { contains: q } }, { customerPhone: { contains: q } }] } : {}),
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(customer ? { customer: { OR: [{ name: { contains: customer } }, { email: { contains: customer } }] } } : {}),
    ...(supplier ? { supplierOrders: { some: { supplierId: supplier } } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, orderNumber: true, customerName: true, customerPhone: true, total: true,
        status: true, paymentStatus: true, paymentMethod: true, createdAt: true,
        customer: { select: { id: true, name: true, email: true } },
        items: { select: { id: true, name: true, quantity: true } },
        supplierOrders: { select: { id: true, status: true, supplier: { select: { id: true, name: true } } } },
      },
    }),
    db.order.count({ where }),
  ]);

  const suppliers = await db.supplier.findMany({ select: { id: true, name: true }, where: { isActive: true } });
  return ok({ ...paginated(orders, total, page, limit), suppliers });
}
