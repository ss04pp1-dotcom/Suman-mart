import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
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

  return ok(paginated(events, total, page, limit));
}
