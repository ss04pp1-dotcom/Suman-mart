import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { parseUserAgent, geoFromHeaders, resolveAttribution, type Attribution } from "@/lib/ua";
import { forwardEventToPixels } from "@/lib/pixels";

// ─────────────────────────────────────────────────────────────────────────
// First-party tracking engine.
//  • Sessions: anonymous session keys, device/browser/OS, UTM attribution
//  • Events: deduplicated by (eventId, source) — browser + server copies
//    of the same logical event share one eventId
//  • Forwarding: server events go to Meta CAPI / GA4 MP / TikTok Events API
//    only when the session granted marketing consent
// ─────────────────────────────────────────────────────────────────────────

export interface IncomingEvent {
  eventId: string;
  name: string;
  url?: string | null;
  productId?: string | null;
  productName?: string | null;
  searchQuery?: string | null;
  searchResults?: number | null;
  value?: number | null;
  quantity?: number | null;
}

export interface SessionInfo {
  sessionKey: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
}

export interface IngestResult {
  recorded: number;
  duplicates: number;
  /** True when the session exceeded its rolling hourly event budget. */
  quotaExceeded?: boolean;
}

// Anti-spoofing budget: a signed session cookie is handed to ANY visitor, so
// the signature alone proves nothing about intent. Purchases are server-only
// (unfakeable revenue), and every other event type is capped per session —
// a scripted client replaying AddToCart/Search floods is bounded to this many
// rows per rolling hour, per session.
const SESSION_HOURLY_EVENT_QUOTA = 250;

async function upsertSession(
  sessionInfo: SessionInfo,
  ua: string,
  headers: Headers,
  isPageView: boolean
): Promise<{ id: string; attribution: Attribution; marketingConsent: boolean | null }> {
  const { device, browser, os } = parseUserAgent(ua);
  const { country, region } = geoFromHeaders(headers);
  const attribution = resolveAttribution(sessionInfo);

  const existing = await db.trackingSession.findUnique({ where: { sessionKey: sessionInfo.sessionKey } });

  let sessionId: string;
  if (existing) {
    await db.trackingSession.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        pageViewCount: existing.pageViewCount + (isPageView ? 1 : 0),
        isReturning: true,
      },
    });
    sessionId = existing.id;
  } else {
    try {
      const created = await db.trackingSession.create({
        data: {
          sessionKey: sessionInfo.sessionKey,
          device,
          browser,
          os,
          country,
          region,
          source: attribution.source,
          medium: attribution.medium,
          campaign: attribution.campaign,
          content: attribution.content,
          term: attribution.term,
          referrer: attribution.referrer,
          landingPath: sessionInfo.landingPath ?? null,
          pageViewCount: isPageView ? 1 : 0,
          isReturning: false,
        },
      });
      sessionId = created.id;
    } catch (err) {
      // Race with a concurrent first beacon (events + consent arriving together)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await db.trackingSession.findUnique({ where: { sessionKey: sessionInfo.sessionKey } });
        if (raced) {
          await db.trackingSession.update({
            where: { id: raced.id },
            data: { lastSeenAt: new Date(), pageViewCount: raced.pageViewCount + (isPageView ? 1 : 0), isReturning: true },
          });
          sessionId = raced.id;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  const latestConsent = await db.cookieConsent.findFirst({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });

  return {
    id: sessionId,
    attribution,
    marketingConsent: latestConsent ? latestConsent.marketing : null,
  };
}

/** Record browser (or server) events with dedup + optional pixel forwarding. */
export async function ingestEvents(
  req: Request,
  sessionInfo: SessionInfo,
  events: IncomingEvent[],
  source: "BROWSER" | "SERVER" = "BROWSER"
): Promise<IngestResult> {
  if (events.length === 0) return { recorded: 0, duplicates: 0 };

  const ua = req.headers.get("user-agent") ?? "";
  const hasPageView = events.some((e) => e.name === "PageView");
  const session = await upsertSession(sessionInfo, ua, req.headers, hasPageView);

  if (source === "BROWSER") {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const recent = await db.trackingEvent.count({
      where: { sessionId: session.id, createdAt: { gte: hourAgo } },
    });
    if (recent + events.length > SESSION_HOURLY_EVENT_QUOTA) {
      return { recorded: 0, duplicates: 0, quotaExceeded: true };
    }
  }

  const sessionRow = await db.trackingSession.findUnique({ where: { id: session.id } });
  const denorm = {
    device: sessionRow?.device ?? null,
    browser: sessionRow?.browser ?? null,
    os: sessionRow?.os ?? null,
    country: sessionRow?.country ?? null,
    trafficSource: sessionRow?.source ?? null,
    campaign: sessionRow?.campaign ?? null,
  };

  // Respect consent: third-party forwarding only with marketing consent.
  // First-party recording always happens for granted-analytics sessions;
  // browser events are never sent here without analytics consent (client enforces).
  const shouldForward = session.marketingConsent === true;

  let recorded = 0;
  let duplicates = 0;
  const insertedIds: string[] = [];

  for (const e of events) {
    if (!e.eventId || !e.name) continue;
    try {
      const row = await db.trackingEvent.create({
        data: {
          eventId: e.eventId,
          sessionId: session.id,
          name: e.name,
          url: e.url ?? null,
          productId: e.productId ?? null,
          productName: e.productName ?? null,
          searchQuery: e.searchQuery ?? null,
          searchResults: e.searchResults ?? null,
          value: e.value ?? null,
          quantity: e.quantity ?? null,
          source,
          ...denorm,
        },
      });
      insertedIds.push(row.id);
      recorded++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicates++; // Same (eventId, source) already stored — dedup applied
      } else {
        console.error("[tracking] insert failed:", err);
      }
    }
  }

  if (shouldForward && insertedIds.length > 0) {
    const delivery = await forwardEventToPixels(
      events.map((e) => ({
        eventId: e.eventId,
        name: e.name,
        url: e.url ?? null,
        value: e.value ?? null,
        currency: "BDT",
        productId: e.productId ?? null,
        productName: e.productName ?? null,
        quantity: e.quantity ?? null,
        searchQuery: e.searchQuery ?? null,
        eventTime: new Date(),
        clientIp: req.headers.get("cf-connecting-ip") ?? undefined,
        userAgent: ua,
        source,
      }))
    );

    // Persist per-provider delivery status on each stored event
    for (const id of insertedIds) {
      await db.trackingEvent
        .update({
          where: { id },
          data: {
            metaStatus: delivery.meta.status,
            ga4Status: delivery.ga4.status,
            tiktokStatus: delivery.tiktok.status,
            deliveryError:
              delivery.meta.error ?? delivery.ga4.error ?? delivery.tiktok.error ?? null,
          },
        })
        .catch(() => undefined);
    }
  }

  return { recorded, duplicates };
}

/**
 * Record a server-side event tied to an order (e.g. Purchase).
 * Uses the same eventId scheme as the browser copy → deduplication.
 */
export async function recordServerEvent(
  event: {
    eventId: string;
    name: string;
    value?: number | null;
    productId?: string | null;
    productName?: string | null;
    quantity?: number | null;
    url?: string | null;
  },
  context?: { sessionKey?: string | null; headers?: Headers }
) {
  const headers = context?.headers ?? new Headers();
  const sessionKey = context?.sessionKey ?? null;

  let sessionId: string | null = null;
  if (sessionKey) {
    const existing = await db.trackingSession.findUnique({ where: { sessionKey } });
    if (existing) sessionId = existing.id;
  }
  if (!sessionId) {
    // Create an anonymous server-side session for order events without a browser session
    const created = await db.trackingSession.create({
      data: {
        sessionKey: `srv_${event.eventId}`,
        device: parseUserAgent(headers.get("user-agent") ?? "").device,
        browser: parseUserAgent(headers.get("user-agent") ?? "").browser,
        os: parseUserAgent(headers.get("user-agent") ?? "").os,
        ...geoFromHeaders(headers),
        source: "DIRECT",
        medium: "none",
        landingPath: event.url ?? null,
      },
    });
    sessionId = created.id;
  }

  const sessionRow = await db.trackingSession.findUnique({ where: { id: sessionId } });

  let insertedId: string | null = null;
  try {
    const row = await db.trackingEvent.create({
      data: {
        eventId: event.eventId,
        sessionId,
        name: event.name,
        url: event.url ?? null,
        productId: event.productId ?? null,
        productName: event.productName ?? null,
        value: event.value ?? null,
        quantity: event.quantity ?? null,
        source: "SERVER",
        device: sessionRow?.device ?? null,
        browser: sessionRow?.browser ?? null,
        os: sessionRow?.os ?? null,
        country: sessionRow?.country ?? null,
        trafficSource: sessionRow?.source ?? null,
        campaign: sessionRow?.campaign ?? null,
      },
    });
    insertedId = row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { recorded: false, duplicate: true };
    }
    throw err;
  }

  // Forward to third-party pixels when the session granted marketing consent
  const consent = await db.cookieConsent.findFirst({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });
  if (consent?.marketing) {
    const delivery = await forwardEventToPixels([
      {
        eventId: event.eventId,
        name: event.name,
        url: event.url ?? null,
        value: event.value ?? null,
        currency: "BDT",
        productId: event.productId ?? null,
        productName: event.productName ?? null,
        quantity: event.quantity ?? null,
        eventTime: new Date(),
        clientIp: headers.get("cf-connecting-ip") ?? undefined,
        userAgent: headers.get("user-agent") ?? undefined,
        source: "SERVER",
      },
    ]);
    if (insertedId) {
      await db.trackingEvent
        .update({
          where: { id: insertedId },
          data: {
            metaStatus: delivery.meta.status,
            ga4Status: delivery.ga4.status,
            tiktokStatus: delivery.tiktok.status,
            deliveryError: delivery.meta.error ?? delivery.ga4.error ?? delivery.tiktok.error ?? null,
          },
        })
        .catch(() => undefined);
    }
  }

  return { recorded: true, duplicate: false };
}

/** Record a cookie consent choice for a session. */
export async function recordConsent(
  sessionKey: string,
  choice: "ACCEPT_ALL" | "ESSENTIAL_ONLY" | "CUSTOM" | "REJECTED",
  analytics: boolean,
  marketing: boolean,
  ua: string,
  headers: Headers
) {
  const session = await upsertSession({ sessionKey, landingPath: null }, ua, headers, false);
  await db.cookieConsent.create({
    data: {
      sessionId: session.id,
      choice,
      analytics: choice === "ACCEPT_ALL" ? true : analytics,
      marketing: choice === "ACCEPT_ALL" ? true : marketing,
    },
  });
  return session.id;
}

// ── Retention ──────────────────────────────────────────────────────
// TrackingEvent grows unboundedly otherwise. Events/consents/sessions older
// than RETENTION_DAYS are pruned (throttled to at most once per hour; also
// exposed as a forced cleanup via the admin maintenance endpoint).

const RETENTION_DAYS = 180;
let lastRetentionRun = 0;

export async function maybeRunRetention(force = false): Promise<{ deletedEvents: number; deletedSessions: number }> {
  const now = Date.now();
  if (!force && (Math.random() > 0.02 || now - lastRetentionRun < 3_600_000)) {
    return { deletedEvents: 0, deletedSessions: 0 };
  }
  lastRetentionRun = now;
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000);

  const events = await db.trackingEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  await db.cookieConsent.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
  // Sessions with no remaining events (FK cascade would have handled children)
  const sessions = await db.trackingSession.deleteMany({ where: { lastSeenAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return { deletedEvents: events.count, deletedSessions: sessions.count };
}
