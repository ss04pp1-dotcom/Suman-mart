import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, resolveRange } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

/**
 * CSV report export.
 * type = sales | orders | products | customers | suppliers | campaigns | traffic | conversion | events
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin("reports.export");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "sales";
  const range = resolveRange(url);

  let rows: Record<string, unknown>[] = [];

  switch (type) {
    case "sales": {
      const data = await db.$queryRawUnsafe<{ day: string; orders: number; revenue: number; discount: number; shipping: number }[]>(
        `SELECT strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') as day, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue,
                COALESCE(SUM(discountTotal),0) as discount, COALESCE(SUM(shippingTotal),0) as shipping
         FROM "Order" WHERE createdAt >= ? AND createdAt <= ? AND status != 'CANCELLED' GROUP BY day ORDER BY day`,
        range.from.getTime(), range.to.getTime()
      );
      rows = data.map((r) => ({ Date: r.day, Orders: Number(r.orders), Revenue: Number(r.revenue), Discount: Number(r.discount), Shipping: Number(r.shipping) }));
      break;
    }
    case "orders": {
      const data = await db.order.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: "desc" },
        select: { orderNumber: true, customerName: true, customerPhone: true, status: true, paymentStatus: true, paymentMethod: true, subtotal: true, discountTotal: true, shippingTotal: true, total: true, createdAt: true },
      });
      rows = data.map((o) => ({
        Order: o.orderNumber, Customer: o.customerName, Phone: o.customerPhone, Status: o.status,
        Payment: o.paymentStatus, Method: o.paymentMethod, Subtotal: o.subtotal, Discount: o.discountTotal,
        Shipping: o.shippingTotal, Total: o.total, Created: o.createdAt.toISOString(),
      }));
      break;
    }
    case "products": {
      const data = await db.$queryRawUnsafe<{ name: string; sku: string; qty: number; revenue: number; category: string }[]>(
        `SELECT p.name, p.sku, SUM(oi.quantity) as qty, SUM(oi.total) as revenue, c.name as category
         FROM OrderItem oi JOIN "Order" o ON o.id = oi.orderId JOIN Product p ON p.id = oi.productId
         JOIN Category c ON c.id = p.categoryId
         WHERE o.createdAt >= ? AND o.createdAt <= ? AND o.status != 'CANCELLED'
         GROUP BY p.id ORDER BY revenue DESC`,
        range.from.getTime(), range.to.getTime()
      );
      rows = data.map((r) => ({ Product: r.name, SKU: r.sku, Category: r.category, Units: Number(r.qty), Revenue: Number(r.revenue) }));
      break;
    }
    case "customers": {
      const data = await db.$queryRawUnsafe<{ name: string; email: string; phone: string; orders: number; spent: number }[]>(
        `SELECT cu.name, cu.email, cu.phone, COUNT(o.id) as orders, COALESCE(SUM(o.total),0) as spent
         FROM Customer cu LEFT JOIN "Order" o ON o.customerId = cu.id AND o.createdAt >= ? AND o.createdAt <= ? AND o.status != 'CANCELLED'
         GROUP BY cu.id ORDER BY spent DESC`,
        range.from.getTime(), range.to.getTime()
      );
      rows = data.map((r) => ({ Customer: r.name, Email: r.email, Phone: r.phone, Orders: Number(r.orders), Spent: Number(r.spent) }));
      break;
    }
    case "suppliers": {
      const data = await db.$queryRawUnsafe<{ supplier: string; orders: number; cost: number; status: string }[]>(
        `SELECT s.name as supplier, COUNT(so.id) as orders, COALESCE(SUM(so.total),0) as cost, so.status
         FROM SupplierOrder so JOIN Supplier s ON s.id = so.supplierId
         WHERE so.createdAt >= ? AND so.createdAt <= ?
         GROUP BY s.id, so.status ORDER BY orders DESC`,
        range.from.getTime(), range.to.getTime()
      );
      rows = data.map((r) => ({ Supplier: r.supplier, Status: r.status, SupplierOrders: Number(r.orders), Cost: Number(r.cost) }));
      break;
    }
    case "campaigns": {
      const { getCampaigns } = await import("@/lib/analytics");
      const data = await getCampaigns(range);
      rows = data.map((c) => ({
        Campaign: c.campaign, Source: c.source, Visitors: c.visitors, AddToCart: c.addToCart,
        Checkout: c.checkout, Purchases: c.purchases, Revenue: c.revenue, ConversionRate: `${c.conversionRate.toFixed(2)}%`,
      }));
      break;
    }
    case "traffic": {
      const { getTrafficSources } = await import("@/lib/analytics");
      const data = await getTrafficSources(range);
      rows = data.map((s) => ({ Source: s.source, Visitors: s.visitors, Purchases: s.purchases, Revenue: s.revenue }));
      break;
    }
    case "conversion": {
      const { getFunnel } = await import("@/lib/analytics");
      const data = await getFunnel(range);
      rows = data.map((f) => ({ Step: f.label, Count: f.count, Conversion: `${f.conversion.toFixed(2)}%`, DropOff: `${f.dropOff.toFixed(2)}%` }));
      break;
    }
    case "events": {
      const data = await db.$queryRawUnsafe<{ name: string; total: number; deduped: number }[]>(
        `SELECT name, COUNT(*) as total, COUNT(DISTINCT CASE WHEN source='BROWSER' THEN eventId END) as deduped
         FROM TrackingEvent WHERE createdAt >= ? AND createdAt <= ? GROUP BY name ORDER BY total DESC`,
        range.from.getTime(), range.to.getTime()
      );
      rows = data.map((r) => ({ Event: r.name, RawEvents: Number(r.total), Deduplicated: Number(r.deduped) }));
      break;
    }
    default:
      return fail("Unknown report type", 422);
  }

  if (rows.length === 0) rows = [{ Info: "No data for the selected range" }];

  // Build CSV — csvEscape neutralizes formula injection (=, +, -, @, tab, CR)
  // alongside standard RFC 4180 quoting
  const headers = Object.keys(rows[0]);
  const { csvEscape } = await import("@/lib/json");
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n");

  await writeAudit(guard.admin.id, "report.exported", "report", type, { rows: rows.length, range: range.key });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shopnest-${type}-report-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
