// Admin analytics endpoints — Hono port of
// apps/storefront/src/app/api/admin/analytics/* (12 routes).

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, pageParams, paginated, resolveRange } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getOverviewKPIs, getDailySeries, getTrafficSources, getDeviceBreakdown,
  getBrowserStats, getGeoStats, getEventCounts, getFunnel, getCampaigns,
  getProductAnalytics, getSearchAnalytics, getLiveActivity, getConsentStats,
  getAbandonedCarts,
} from "@/lib/analytics";
import type { Prisma } from "@/generated/prisma/client";

export const adminAnalyticsApi = new Hono<{ Bindings: Env }>();

adminAnalyticsApi.get("/overview", async (c) => {
  await requireAdmin(c, "analytics.view");

  const range = resolveRange(new URL(c.req.url));
  const [kpis, series, sources, devices, browsers, geo, eventCounts] = await Promise.all([
    getOverviewKPIs(range),
    getDailySeries(range),
    getTrafficSources(range),
    getDeviceBreakdown(range),
    getBrowserStats(range),
    getGeoStats(range),
    getEventCounts(range),
  ]);

  return ok(c, { range: { from: range.from, to: range.to, key: range.key }, kpis, series, sources, devices, ...browsers, geo, eventCounts });
});

adminAnalyticsApi.get("/funnel", async (c) => {
  await requireAdmin(c, "analytics.view");
  const range = resolveRange(new URL(c.req.url));
  return ok(c, await getFunnel(range));
});

adminAnalyticsApi.get("/campaigns", async (c) => {
  await requireAdmin(c, "analytics.view");
  const range = resolveRange(new URL(c.req.url));
  return ok(c, await getCampaigns(range));
});

adminAnalyticsApi.get("/products", async (c) => {
  await requireAdmin(c, "analytics.view");
  const url = new URL(c.req.url);
  const range = resolveRange(url);
  const take = Math.min(30, parseInt(url.searchParams.get("take") ?? "12", 10) || 12);
  return ok(c, await getProductAnalytics(range, take));
});

adminAnalyticsApi.get("/searches", async (c) => {
  await requireAdmin(c, "analytics.view");
  const range = resolveRange(new URL(c.req.url));
  return ok(c, await getSearchAnalytics(range, 20));
});

adminAnalyticsApi.get("/live", async (c) => {
  await requireAdmin(c, "analytics.view");
  const take = Math.min(30, parseInt(new URL(c.req.url).searchParams.get("take") ?? "20", 10) || 20);
  return ok(c, await getLiveActivity(take));
});

adminAnalyticsApi.get("/consent", async (c) => {
  await requireAdmin(c, "analytics.view");
  const range = resolveRange(new URL(c.req.url));
  return ok(c, await getConsentStats(range));
});

adminAnalyticsApi.get("/abandoned", async (c) => {
  await requireAdmin(c, "analytics.view");
  const range = resolveRange(new URL(c.req.url));
  return ok(c, await getAbandonedCarts(range));
});

// GET /v1/admin/analytics/events — filtered event log
adminAnalyticsApi.get("/events", async (c) => {
  await requireAdmin(c, "analytics.view");

  const url = new URL(c.req.url);
  const { page, limit, skip, take } = pageParams(url, 20);
  const event = url.searchParams.get("event");
  const productId = url.searchParams.get("product");
  const source = url.searchParams.get("source");
  const campaign = url.searchParams.get("campaign");
  const device = url.searchParams.get("device");
  const q = url.searchParams.get("q")?.trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Prisma.TrackingEventWhereInput = {
    ...(event ? { name: event } : {}),
    ...(productId ? { productId } : {}),
    ...(source ? { trafficSource: source } : {}),
    ...(campaign ? { campaign } : {}),
    ...(device ? { device } : {}),
    ...(q ? { OR: [{ productName: { contains: q } }, { searchQuery: { contains: q } }, { eventId: { contains: q } }] } : {}),
    ...((from || to)
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
      : {}),
  };

  const [events, total] = await Promise.all([
    db.trackingEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, eventId: true, name: true, url: true, productId: true, productName: true,
        searchQuery: true, value: true, quantity: true, source: true, device: true, browser: true,
        trafficSource: true, campaign: true, country: true, createdAt: true,
        metaStatus: true, ga4Status: true, tiktokStatus: true,
      },
    }),
    db.trackingEvent.count({ where }),
  ]);

  return ok(c, paginated(events, total, page, limit));
});

// GET /v1/admin/analytics/events/:id — event inspector with dedup view
adminAnalyticsApi.get("/events/:id", async (c) => {
  await requireAdmin(c, "analytics.view");
  const id = c.req.param("id");

  const event = await db.trackingEvent.findUnique({
    where: { id },
    include: {
      session: {
        select: {
          sessionKey: true, device: true, browser: true, os: true, country: true, region: true,
          source: true, medium: true, campaign: true, referrer: true, landingPath: true,
          firstSeenAt: true, isReturning: true, pageViewCount: true,
        },
      },
    },
  });
  if (!event) return fail(c, "Event not found", 404);

  // Dedup view: all copies of the same logical event (browser + server)
  const copies = await db.trackingEvent.findMany({
    where: { eventId: event.eventId },
    select: { id: true, source: true, metaStatus: true, ga4Status: true, tiktokStatus: true, deliveryError: true, createdAt: true },
  });

  return ok(c, {
    event: {
      id: event.id, eventId: event.eventId, name: event.name, url: event.url,
      productId: event.productId, productName: event.productName, searchQuery: event.searchQuery,
      value: event.value, currency: event.currency, quantity: event.quantity,
      device: event.device, browser: event.browser, country: event.country,
      trafficSource: event.trafficSource, campaign: event.campaign, createdAt: event.createdAt,
    },
    session: event.session,
    copies,
    deduplication: {
      browserReceived: copies.some((cp) => cp.source === "BROWSER"),
      serverReceived: copies.some((cp) => cp.source === "SERVER"),
      applied: copies.length > 1,
      copyCount: copies.length,
    },
  });
});
