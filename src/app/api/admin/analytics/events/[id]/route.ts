import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

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
  if (!event) return fail("Event not found", 404);

  // Dedup view: all copies of the same logical event (browser + server)
  const copies = await db.trackingEvent.findMany({
    where: { eventId: event.eventId },
    select: { id: true, source: true, metaStatus: true, ga4Status: true, tiktokStatus: true, deliveryError: true, createdAt: true },
  });

  return ok({
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
      browserReceived: copies.some((c) => c.source === "BROWSER"),
      serverReceived: copies.some((c) => c.source === "SERVER"),
      applied: copies.length > 1,
      copyCount: copies.length,
    },
  });
}
