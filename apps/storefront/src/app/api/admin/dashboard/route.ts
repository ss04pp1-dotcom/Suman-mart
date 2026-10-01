import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, resolveRange, dayBuckets } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("dashboard.view");
  if (guard instanceof NextResponse) return guard;

  const range = resolveRange(new URL(req.url));
  const prevFrom = new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime()));
  const prevRange = { from: prevFrom, to: new Date(range.from.getTime() - 1) };

  const [
    totalSalesAgg, prevSalesAgg, totalOrders, prevOrders, pendingOrders,
    totalCustomers, totalProducts, lowStock, deliveredAgg, prevDeliveredAgg,
  ] = await Promise.all([
    db.order.aggregate({ where: { status: { not: "CANCELLED" }, createdAt: { gte: range.from, lte: range.to } }, _sum: { total: true } }),
    db.order.aggregate({ where: { status: { not: "CANCELLED" }, createdAt: { gte: prevRange.from, lte: prevRange.to } }, _sum: { total: true } }),
    db.order.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    db.order.count({ where: { createdAt: { gte: prevRange.from, lte: prevRange.to } } }),
    db.order.count({ where: { status: "PENDING" } }),
    db.customer.count(),
    db.product.count(),
    db.product.findMany({ where: { stock: { lte: db.product.fields.lowStockThreshold } , isActive: true }, select: { id: true, name: true, stock: true, lowStockThreshold: true, slug: true }, take: 10, orderBy: { stock: "asc" } }),
    db.order.aggregate({ where: { status: "DELIVERED", createdAt: { gte: range.from, lte: range.to } }, _sum: { total: true }, _count: true }),
    db.order.aggregate({ where: { status: "DELIVERED", createdAt: { gte: prevRange.from, lte: prevRange.to } }, _sum: { total: true }, _count: true }),
  ]);

  // Conversion from tracking
  const { getOverviewKPIs } = await import("@/lib/analytics");
  const kpis = await getOverviewKPIs(range);

  const revenue = totalSalesAgg._sum.total ?? 0;
  const prevRevenue = prevSalesAgg._sum.total ?? 0;
  const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : revenue > 0 ? 100 : 0;
  const ordersDelta = prevOrders > 0 ? ((totalOrders - prevOrders) / prevOrders) * 100 : totalOrders > 0 ? 100 : 0;

  const days = dayBuckets(range.from, range.to);
  const [salesRows, topProducts, recentOrders, sourceRows] = await Promise.all([
    db.$queryRawUnsafe<{ day: string; orders: number; revenue: number }[]>(
      `SELECT strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') as day, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
       FROM "Order" WHERE createdAt >= ? AND createdAt <= ? AND status != 'CANCELLED' GROUP BY day`,
      range.from.getTime(), range.to.getTime()
    ),
    db.$queryRawUnsafe<{ name: string; slug: string; qty: number; revenue: number }[]>(
      `SELECT p.name, p.slug, SUM(oi.quantity) as qty, SUM(oi.total) as revenue
       FROM OrderItem oi JOIN "Order" o ON o.id = oi.orderId JOIN Product p ON p.id = oi.productId
       WHERE o.createdAt >= ? AND o.createdAt <= ? AND o.status != 'CANCELLED'
       GROUP BY p.id ORDER BY revenue DESC LIMIT 6`,
      range.from.getTime(), range.to.getTime()
    ),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, orderNumber: true, customerName: true, total: true, status: true, paymentStatus: true, createdAt: true },
    }),
    db.$queryRawUnsafe<{ source: string; visitors: number }[]>(
      `SELECT source, COUNT(*) as visitors FROM TrackingSession
       WHERE firstSeenAt >= ? AND firstSeenAt <= ? GROUP BY source ORDER BY visitors DESC`,
      range.from.getTime(), range.to.getTime()
    ),
  ]);

  const sessionRows = await db.$queryRawUnsafe<{ day: string; count: number }[]>(
    `SELECT strftime('%Y-%m-%d', firstSeenAt/1000, 'unixepoch') as day, COUNT(*) as count
     FROM TrackingSession WHERE firstSeenAt >= ? AND firstSeenAt <= ? GROUP BY day`,
    range.from.getTime(), range.to.getTime()
  );
  const salesMap = new Map(salesRows.map((r) => [r.day, { orders: Number(r.orders), revenue: Number(r.revenue) }]));
  const sessionMap = new Map(sessionRows.map((r) => [r.day, Number(r.count)]));
  const deliveredCount = deliveredAgg._count;
  const prevDeliveredCount = prevDeliveredAgg._count;
  const aov = totalOrders > 0 ? revenue / totalOrders : 0;
  const prevAov = prevOrders > 0 ? prevRevenue / prevOrders : 0;

  return ok({
    kpis: {
      totalSales: revenue,
      revenueDelta,
      totalOrders,
      ordersDelta,
      pendingOrders,
      totalCustomers,
      totalProducts,
      lowStockCount: lowStock.length,
      conversionRate: kpis.conversionRate,
      aov,
      aovDelta: prevAov > 0 ? ((aov - prevAov) / prevAov) * 100 : 0,
      deliveredOrders: deliveredCount,
      deliveredDelta: prevDeliveredCount > 0 ? ((deliveredCount - prevDeliveredCount) / prevDeliveredCount) * 100 : 0,
    },
    salesSeries: days.map((d) => ({ date: d, orders: salesMap.get(d)?.orders ?? 0, revenue: salesMap.get(d)?.revenue ?? 0, sessions: sessionMap.get(d) ?? 0 })),
    topProducts: topProducts.map((p) => ({ name: p.name, slug: p.slug, qty: Number(p.qty), revenue: Number(p.revenue) })),
    recentOrders,
    trafficSources: sourceRows.map((s) => ({ source: s.source, visitors: Number(s.visitors) })),
    lowStock,
  });
}
