import { db } from "@/lib/db";
import { dayBuckets, type DateRange } from "@/lib/api";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────
// Analytics aggregation engine.
//  • Revenue is always sourced from the ORDERS table (authoritative)
//  • Funnel/traffic metrics come from tracking sessions/events
//  • Purchases are counted as DISTINCT eventIds (browser+server dedup)
// ─────────────────────────────────────────────────────────────────────────

export interface OverviewKPIs {
  visitors: number;
  uniqueVisitors: number;
  pageViews: number;
  productViews: number;
  searches: number;
  addToCart: number;
  checkoutStarted: number;
  paymentAttempts: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
  aov: number;
  abandonedCarts: number;
  abandonedValue: number;
  returningVisitors: number;
  newVisitors: number;
  orders: number;
  pendingOrders: number;
}

export interface DailyPoint {
  date: string;
  sessions: number;
  orders: number;
  revenue: number;
}

export interface SourceBreakdown {
  source: string;
  visitors: number;
  purchases: number;
  revenue: number;
}

export interface DeviceBreakdown {
  device: string;
  visitors: number;
  share: number;
}

export async function getOverviewKPIs(range: DateRange): Promise<OverviewKPIs> {
  const evWhere: Prisma.TrackingEventWhereInput = { createdAt: { gte: range.from, lte: range.to } };
  const sessWhere: Prisma.TrackingSessionWhereInput = { firstSeenAt: { gte: range.from, lte: range.to } };

  const [
    sessionsCount,
    pageViews,
    productViews,
    searches,
    addToCart,
    checkoutStarted,
    paymentAttempts,
    returningVisitors,
    orderAgg,
    pendingOrders,
    abandonedAgg,
    purchaseAgg,
  ] = await Promise.all([
    db.trackingSession.count({ where: sessWhere }),
    db.trackingEvent.count({ where: { ...evWhere, name: "PageView" } }),
    db.trackingEvent.count({ where: { ...evWhere, name: "ViewContent" } }),
    db.trackingEvent.count({ where: { ...evWhere, name: "Search" } }),
    db.trackingEvent.count({ where: { ...evWhere, name: "AddToCart", source: "BROWSER" } }),
    db.trackingEvent.count({ where: { ...evWhere, name: "InitiateCheckout", source: "BROWSER" } }),
    db.trackingEvent.count({ where: { ...evWhere, name: "AddPaymentInfo", source: "BROWSER" } }),
    db.trackingSession.count({ where: { ...sessWhere, isReturning: true } }),
    db.order.aggregate({ where: { createdAt: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } }, _sum: { total: true }, _count: true }),
    db.order.count({ where: { createdAt: { gte: range.from, lte: range.to }, status: "PENDING" } }),
    // Abandoned: sessions with AddToCart but no Purchase
    db.$queryRawUnsafe<{ cnt: number; value: number }[]>(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(t.value), 0) as value
      FROM (
        SELECT e.sessionId, MAX(e.value) as value
        FROM TrackingEvent e
        WHERE e.name = 'AddToCart' AND e.createdAt >= ? AND e.createdAt <= ?
        AND e.sessionId NOT IN (
          SELECT DISTINCT sessionId FROM TrackingEvent WHERE name = 'Purchase' AND sessionId IS NOT NULL
        )
        GROUP BY e.sessionId
      ) t
    `, range.from.getTime(), range.to.getTime()),
    // Purchases: distinct eventIds (dedup browser+server)
    db.$queryRawUnsafe<{ cnt: number; value: number }[]>(`
      SELECT COUNT(DISTINCT eventId) as cnt, COALESCE(SUM(t.value), 0) as value FROM (
        SELECT eventId, MAX(value) as value FROM TrackingEvent
        WHERE name = 'Purchase' AND createdAt >= ? AND createdAt <= ?
        GROUP BY eventId
      ) t
    `, range.from.getTime(), range.to.getTime()),
  ]);

  const purchases = Number(purchaseAgg[0]?.cnt ?? 0);
  const revenue = orderAgg._sum.total ?? 0;
  const orders = orderAgg._count;
  const abandoned = abandonedAgg[0] ? Number(abandonedAgg[0].cnt) : 0;

  return {
    visitors: sessionsCount,
    uniqueVisitors: sessionsCount,
    pageViews,
    productViews,
    searches,
    addToCart,
    checkoutStarted,
    paymentAttempts,
    purchases,
    revenue,
    conversionRate: sessionsCount > 0 ? (purchases / sessionsCount) * 100 : 0,
    aov: orders > 0 ? revenue / orders : 0,
    abandonedCarts: abandoned,
    abandonedValue: Number(abandonedAgg[0]?.value ?? 0),
    returningVisitors,
    newVisitors: sessionsCount - returningVisitors,
    orders,
    pendingOrders,
  };
}

export async function getDailySeries(range: DateRange): Promise<DailyPoint[]> {
  const days = dayBuckets(range.from, range.to);

  const [sessionRows, orderRows] = await Promise.all([
    db.$queryRawUnsafe<{ day: string; count: number }[]>(
      `SELECT strftime('%Y-%m-%d', firstSeenAt/1000, 'unixepoch') as day, COUNT(*) as count FROM TrackingSession
       WHERE firstSeenAt >= ? AND firstSeenAt <= ? GROUP BY day`,
      range.from.getTime(), range.to.getTime()
    ),
    db.$queryRawUnsafe<{ day: string; count: number; revenue: number }[]>(
      `SELECT strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') as day, COUNT(*) as count, COALESCE(SUM(total), 0) as revenue
       FROM "Order" WHERE createdAt >= ? AND createdAt <= ? AND status != 'CANCELLED'
       GROUP BY day`,
      range.from.getTime(), range.to.getTime()
    ),
  ]);

  const sessionMap = new Map(sessionRows.map((r) => [r.day, Number(r.count)]));
  const orderMap = new Map(orderRows.map((r) => [r.day, { count: Number(r.count), revenue: Number(r.revenue) }]));

  return days.map((date) => ({
    date,
    sessions: sessionMap.get(date) ?? 0,
    orders: orderMap.get(date)?.count ?? 0,
    revenue: orderMap.get(date)?.revenue ?? 0,
  }));
}

export async function getTrafficSources(range: DateRange): Promise<SourceBreakdown[]> {
  const rows = await db.$queryRawUnsafe<{ source: string; visitors: number; purchases: number; revenue: number }[]>(
    `SELECT s.source as source,
            COUNT(DISTINCT s.id) as visitors,
            COUNT(DISTINCT CASE WHEN e.name = 'Purchase' THEN e.eventId END) as purchases,
            COALESCE(SUM(CASE WHEN e.name = 'Purchase' THEN e.value ELSE 0 END), 0) as revenue
     FROM TrackingSession s
     LEFT JOIN TrackingEvent e ON e.sessionId = s.id
     WHERE s.firstSeenAt >= ? AND s.firstSeenAt <= ?
     GROUP BY s.source
     ORDER BY visitors DESC`,
    range.from.getTime(), range.to.getTime()
  );
  return rows.map((r) => ({
    source: r.source,
    visitors: Number(r.visitors),
    purchases: Number(r.purchases),
    revenue: Number(r.revenue),
  }));
}

export async function getDeviceBreakdown(range: DateRange): Promise<DeviceBreakdown[]> {
  const rows = await db.trackingSession.groupBy({
    by: ["device"],
    where: { firstSeenAt: { gte: range.from, lte: range.to } },
    _count: { device: true },
  });
  const total = rows.reduce((sum, r) => sum + r._count.device, 0) || 1;
  return rows
    .map((r) => ({ device: r.device, visitors: r._count.device, share: (r._count.device / total) * 100 }))
    .sort((a, b) => b.visitors - a.visitors);
}

export async function getBrowserStats(range: DateRange) {
  const browsers = await db.trackingSession.groupBy({
    by: ["browser"],
    where: { firstSeenAt: { gte: range.from, lte: range.to } },
    _count: { browser: true },
    orderBy: { _count: { browser: "desc" } },
    take: 8,
  });
  const oses = await db.trackingSession.groupBy({
    by: ["os"],
    where: { firstSeenAt: { gte: range.from, lte: range.to } },
    _count: { os: true },
    orderBy: { _count: { os: "desc" } },
    take: 8,
  });
  return {
    browsers: browsers.map((b) => ({ name: b.browser ?? "Unknown", count: b._count.browser })),
    oses: oses.map((o) => ({ name: o.os ?? "Unknown", count: o._count.os })),
  };
}

export async function getGeoStats(range: DateRange) {
  const countries = await db.trackingSession.groupBy({
    by: ["country"],
    where: { firstSeenAt: { gte: range.from, lte: range.to } },
    _count: { country: true },
    orderBy: { _count: { country: "desc" } },
    take: 10,
  });
  return countries.map((c) => ({ country: c.country ?? "Unknown", visitors: c._count.country }));
}

export interface FunnelStep {
  name: string;
  label: string;
  count: number;
  conversion: number; // vs previous step
  dropOff: number;
}

export async function getFunnel(range: DateRange): Promise<FunnelStep[]> {
  const [visitors, productViews, atc, checkout, payment, purchases] = await Promise.all([
    db.trackingSession.count({ where: { firstSeenAt: { gte: range.from, lte: range.to } } }),
    db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(DISTINCT sessionId) as c FROM TrackingEvent
      WHERE name = 'ViewContent' AND createdAt >= ? AND createdAt <= ?`, range.from.getTime(), range.to.getTime()),
    db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(DISTINCT sessionId) as c FROM TrackingEvent
      WHERE name = 'AddToCart' AND createdAt >= ? AND createdAt <= ?`, range.from.getTime(), range.to.getTime()),
    db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(DISTINCT sessionId) as c FROM TrackingEvent
      WHERE name = 'InitiateCheckout' AND createdAt >= ? AND createdAt <= ?`, range.from.getTime(), range.to.getTime()),
    db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(DISTINCT sessionId) as c FROM TrackingEvent
      WHERE name = 'AddPaymentInfo' AND createdAt >= ? AND createdAt <= ?`, range.from.getTime(), range.to.getTime()),
    db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(DISTINCT sessionId) as c FROM TrackingEvent
      WHERE name = 'Purchase' AND createdAt >= ? AND createdAt <= ?`, range.from.getTime(), range.to.getTime()),
  ]);

  const steps: { name: string; label: string; count: number }[] = [
    { name: "visitors", label: "Visitors", count: visitors },
    { name: "productViews", label: "Product Views", count: Number(productViews[0]?.c ?? 0) },
    { name: "addToCart", label: "Add to Cart", count: Number(atc[0]?.c ?? 0) },
    { name: "checkout", label: "Checkout", count: Number(checkout[0]?.c ?? 0) },
    { name: "payment", label: "Payment Info", count: Number(payment[0]?.c ?? 0) },
    { name: "purchase", label: "Purchase", count: Number(purchases[0]?.c ?? 0) },
  ];

  return steps.map((step, i) => {
    const prev = i === 0 ? step.count : steps[i - 1].count;
    return {
      ...step,
      conversion: prev > 0 ? (step.count / prev) * 100 : 0,
      dropOff: prev > 0 ? ((prev - step.count) / prev) * 100 : 0,
    };
  });
}

export interface CampaignRow {
  campaign: string;
  source: string;
  visitors: number;
  addToCart: number;
  checkout: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
}

export async function getCampaigns(range: DateRange): Promise<CampaignRow[]> {
  const rows = await db.$queryRawUnsafe<
    { campaign: string; source: string; visitors: number; atc: number; checkout: number; purchases: number; revenue: number }[]
  >(
    `SELECT s.campaign as campaign, s.source as source,
            COUNT(DISTINCT s.id) as visitors,
            COUNT(DISTINCT CASE WHEN e.name = 'AddToCart' THEN e.sessionId END) as atc,
            COUNT(DISTINCT CASE WHEN e.name = 'InitiateCheckout' THEN e.sessionId END) as checkout,
            COUNT(DISTINCT CASE WHEN e.name = 'Purchase' THEN e.eventId END) as purchases,
            COALESCE(SUM(CASE WHEN e.name = 'Purchase' THEN e.value ELSE 0 END), 0) as revenue
     FROM TrackingSession s
     LEFT JOIN TrackingEvent e ON e.sessionId = s.id
     WHERE s.firstSeenAt >= ? AND s.firstSeenAt <= ? AND s.campaign IS NOT NULL AND s.campaign != ''
     GROUP BY s.campaign, s.source
     ORDER BY visitors DESC`,
    range.from.getTime(), range.to.getTime()
  );

  return rows.map((r) => ({
    campaign: r.campaign,
    source: r.source,
    visitors: Number(r.visitors),
    addToCart: Number(r.atc),
    checkout: Number(r.checkout),
    purchases: Number(r.purchases),
    revenue: Number(r.revenue),
    conversionRate: Number(r.visitors) > 0 ? (Number(r.purchases) / Number(r.visitors)) * 100 : 0,
  }));
}

export interface ProductAnalyticsRow {
  productId: string;
  name: string;
  slug: string;
  views: number;
  uniqueViews: number;
  addToCart: number;
  checkout: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
}

export async function getProductAnalytics(range: DateRange, take = 12): Promise<ProductAnalyticsRow[]> {
  const eventRows = await db.$queryRawUnsafe<
    { productId: string; views: number; uniqueViews: number; atc: number; checkout: number; purchases: number }[]
  >(
    `SELECT productId,
            SUM(CASE WHEN name = 'ViewContent' THEN 1 ELSE 0 END) as views,
            COUNT(DISTINCT CASE WHEN name = 'ViewContent' THEN sessionId END) as uniqueViews,
            SUM(CASE WHEN name = 'AddToCart' THEN 1 ELSE 0 END) as atc,
            SUM(CASE WHEN name = 'InitiateCheckout' THEN 1 ELSE 0 END) as checkout,
            COUNT(DISTINCT CASE WHEN name = 'Purchase' THEN eventId END) as purchases
     FROM TrackingEvent
     WHERE productId IS NOT NULL AND createdAt >= ? AND createdAt <= ?
     GROUP BY productId`,
    range.from.getTime(), range.to.getTime()
  );

  const revenueRows = await db.$queryRawUnsafe<{ productId: string; revenue: number; qty: number }[]>(
    `SELECT oi.productId, COALESCE(SUM(oi.total), 0) as revenue, SUM(oi.quantity) as qty
     FROM OrderItem oi JOIN "Order" o ON o.id = oi.orderId
     WHERE oi.productId IS NOT NULL AND o.createdAt >= ? AND o.createdAt <= ? AND o.status != 'CANCELLED'
     GROUP BY oi.productId`,
    range.from.getTime(), range.to.getTime()
  );

  const productIds = [...new Set([...eventRows.map((r) => r.productId), ...revenueRows.map((r) => r.productId)])];
  if (productIds.length === 0) return [];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, slug: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const eventMap = new Map(eventRows.map((r) => [r.productId, r]));
  const revenueMap = new Map(revenueRows.map((r) => [r.productId, Number(r.revenue)]));

  return productIds
    .map((id) => {
      const e = eventMap.get(id);
      const views = Number(e?.views ?? 0);
      const purchases = Number(e?.purchases ?? 0);
      return {
        productId: id,
        name: productMap.get(id)?.name ?? "Deleted product",
        slug: productMap.get(id)?.slug ?? "",
        views,
        uniqueViews: Number(e?.uniqueViews ?? 0),
        addToCart: Number(e?.atc ?? 0),
        checkout: Number(e?.checkout ?? 0),
        purchases,
        revenue: revenueMap.get(id) ?? 0,
        conversionRate: views > 0 ? (purchases / views) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.views - a.views)
    .slice(0, take);
}

export interface SearchRow {
  query: string;
  count: number;
  avgResults: number;
  toView: number;
  toCart: number;
  toPurchase: number;
}

export async function getSearchAnalytics(range: DateRange, take = 20): Promise<SearchRow[]> {
  const rows = await db.$queryRawUnsafe<
    { query: string; count: number; avgResults: number; toView: number; toCart: number; toPurchase: number }[]
  >(
    `SELECT searchQuery as query,
            COUNT(*) as count,
            AVG(searchResults) as avgResults,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM TrackingEvent v WHERE v.sessionId = e.sessionId AND v.name = 'ViewContent'
              AND v.createdAt >= e.createdAt AND v.createdAt <= e.createdAt + 1800000
            ) THEN 1 ELSE 0 END) as toView,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM TrackingEvent c WHERE c.sessionId = e.sessionId AND c.name = 'AddToCart'
              AND c.createdAt >= e.createdAt AND c.createdAt <= e.createdAt + 1800000
            ) THEN 1 ELSE 0 END) as toCart,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM TrackingEvent p WHERE p.sessionId = e.sessionId AND p.name = 'Purchase'
              AND p.createdAt >= e.createdAt AND p.createdAt <= e.createdAt + 7200000
            ) THEN 1 ELSE 0 END) as toPurchase
     FROM TrackingEvent e
     WHERE name = 'Search' AND searchQuery IS NOT NULL AND searchQuery != ''
       AND createdAt >= ? AND createdAt <= ?
     GROUP BY query
     ORDER BY count DESC
     LIMIT ?`,
    range.from.getTime(), range.to.getTime(), take
  );

  return rows.map((r) => ({
    query: r.query,
    count: Number(r.count),
    avgResults: Math.round(Number(r.avgResults ?? 0)),
    toView: Number(r.toView ?? 0),
    toCart: Number(r.toCart ?? 0),
    toPurchase: Number(r.toPurchase ?? 0),
  }));
}

export async function getConsentStats(range: DateRange) {
  const rows = await db.cookieConsent.groupBy({
    by: ["choice"],
    where: { createdAt: { gte: range.from, lte: range.to } },
    _count: { choice: true },
  });
  const [analyticsAllowed, marketingAllowed] = await Promise.all([
    db.cookieConsent.count({ where: { createdAt: { gte: range.from, lte: range.to }, analytics: true } }),
    db.cookieConsent.count({ where: { createdAt: { gte: range.from, lte: range.to }, marketing: true } }),
  ]);
  const total = rows.reduce((s, r) => s + r._count.choice, 0);
  const map = Object.fromEntries(rows.map((r) => [r.choice, r._count.choice]));
  return {
    total,
    acceptAll: map["ACCEPT_ALL"] ?? 0,
    essentialOnly: map["ESSENTIAL_ONLY"] ?? 0,
    custom: map["CUSTOM"] ?? 0,
    rejected: map["REJECTED"] ?? 0,
    analyticsAllowed,
    marketingAllowed,
  };
}

export interface AbandonedRow {
  day: string;
  carts: number;
  value: number;
}

export async function getAbandonedCarts(range: DateRange) {
  const rows = await db.$queryRawUnsafe<{ day: string; carts: number; value: number }[]>(
    `SELECT strftime('%Y-%m-%d', t.createdAt/1000, 'unixepoch') as day, COUNT(*) as carts, COALESCE(SUM(t.value), 0) as value FROM (
       SELECT e.sessionId, MAX(e.value) as value, MAX(e.createdAt) as createdAt
       FROM TrackingEvent e
       WHERE e.name = 'AddToCart' AND e.createdAt >= ? AND e.createdAt <= ?
       AND e.sessionId NOT IN (SELECT DISTINCT sessionId FROM TrackingEvent WHERE name = 'Purchase' AND sessionId IS NOT NULL)
       GROUP BY e.sessionId
     ) t GROUP BY day ORDER BY day`,
    range.from.getTime(), range.to.getTime()
  );

  const topProducts = await db.$queryRawUnsafe<{ productName: string; carts: number; value: number }[]>(
    `SELECT productName, COUNT(*) as carts, COALESCE(SUM(value), 0) as value FROM TrackingEvent e
     WHERE e.name = 'AddToCart' AND e.createdAt >= ? AND e.createdAt <= ?
       AND e.sessionId NOT IN (SELECT DISTINCT sessionId FROM TrackingEvent WHERE name = 'Purchase' AND sessionId IS NOT NULL)
       AND productName IS NOT NULL
     GROUP BY productName ORDER BY carts DESC LIMIT 8`,
    range.from.getTime(), range.to.getTime()
  );

  const kpis = await getOverviewKPIs(range);

  return {
    cartCreated: kpis.addToCart,
    checkoutStarted: kpis.checkoutStarted,
    completed: kpis.purchases,
    abandoned: kpis.abandonedCarts,
    abandonedValue: kpis.abandonedValue,
    byDay: rows.map((r) => ({ day: r.day, carts: Number(r.carts), value: Number(r.value) })),
    topProducts: topProducts.map((r) => ({ productName: r.productName, carts: Number(r.carts), value: Number(r.value) })),
  };
}

export interface LiveActivityItem {
  id: string;
  name: string;
  label: string;
  productName: string | null;
  value: number | null;
  device: string | null;
  source: string | null;
  createdAt: string;
}

export async function getLiveActivity(take = 20): Promise<LiveActivityItem[]> {
  const events = await db.trackingEvent.findMany({
    where: { name: { in: ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase", "Search", "AddToWishlist"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      name: true,
      productName: true,
      searchQuery: true,
      value: true,
      device: true,
      trafficSource: true,
      createdAt: true,
      source: true,
    },
  });

  return events.map((e) => {
    let label: string;
    switch (e.name) {
      case "ViewContent":
        label = "viewed";
        break;
      case "AddToCart":
        label = "added to cart";
        break;
      case "InitiateCheckout":
        label = "started checkout";
        break;
      case "Purchase":
        label = "purchased";
        break;
      case "Search":
        label = "searched";
        break;
      default:
        label = "added to wishlist";
    }
    return {
      id: e.id,
      name: e.name,
      label,
      productName: e.name === "Search" ? `"${e.searchQuery}"` : e.productName,
      value: e.value,
      device: e.device,
      source: e.trafficSource,
      createdAt: e.createdAt.toISOString(),
    };
  });
}

export async function getEventCounts(range: DateRange) {
  const rows = await db.$queryRawUnsafe<{ name: string; count: number; dedup: number }[]>(
    `SELECT name, COUNT(*) as count, COUNT(DISTINCT CASE WHEN source = 'BROWSER' THEN eventId END) as dedup
     FROM TrackingEvent
     WHERE createdAt >= ? AND createdAt <= ?
     GROUP BY name`,
    range.from.getTime(), range.to.getTime()
  );
  return rows.map((r) => ({ name: r.name, count: Number(r.count), deduped: Number(r.dedup) }));
}
