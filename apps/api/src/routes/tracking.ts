// Tracking endpoints — Hono port of
// apps/storefront/src/app/api/tracking/* (session, events, consent).

import { Hono } from "hono";
import type { Env } from "../env";
import { ok, fail } from "@/lib/api";
import { ipRateLimit } from "@/lib/rate-limit";
import { issueTrackingSession, verifyTrackingSession } from "@/lib/tracking-session";
import { ingestEvents, recordConsent, maybeRunRetention } from "@/lib/tracking";
import { consentSchema, trackingEventSchema } from "@/lib/validators";

export const trackingApi = new Hono<{ Bindings: Env }>();

// GET /v1/tracking/session
//
// Issues the signed, first-party tracking session (sn_sk + sn_sks cookies).
// Called once by the storefront tracking client when no valid pair exists.
// Purely anonymous — a random key; nothing is recorded until the visitor
// grants consent. Rate limited so scripts cannot farm fresh sessions to
// dodge the per-session event quota.
trackingApi.get("/session", async (c) => {
  const rl = await ipRateLimit("track-session", 30, 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Rate limit exceeded", 429);
  const { sessionKey } = await issueTrackingSession(c);
  return ok(c, { sessionKey });
});

// POST /v1/tracking/events
//
// Signed-session + rate limited collector for storefront beacons:
//  • the payload sessionKey must match the HMAC-signed cookie pair
//  • Purchase events are SERVER-ONLY (recorded from checkout) — browser
//    copies are dropped here so revenue can never be faked from a client
trackingApi.post("/events", async (c) => {
  const rl = await ipRateLimit("track", 120, 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Rate limit exceeded", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = trackingEventSchema.safeParse(body);
  if (!parsed.success) return fail(c, "Invalid tracking payload", 422);

  const { session, events } = parsed.data;

  if (!(await verifyTrackingSession(c.req.raw, session.sessionKey))) {
    return fail(c, "Invalid tracking session", 403);
  }

  // Purchase is authoritative only from the server (checkout pipeline)
  const safeEvents = events.filter((e) => e.name !== "Purchase");

  const result = await ingestEvents(c.req.raw, session, safeEvents, "BROWSER");
  if (result.quotaExceeded) return fail(c, "Event quota exceeded for this session", 429);

  // Opportunistic retention cleanup (throttled internally)
  c.executionCtx.waitUntil(maybeRunRetention().catch(() => undefined));

  return ok(c, result);
});

// POST /v1/tracking/consent
trackingApi.post("/consent", async (c) => {
  const rl = await ipRateLimit("consent", 30, 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Rate limit exceeded", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = consentSchema.safeParse(body);
  if (!parsed.success) return fail(c, "Invalid consent payload", 422);

  const { sessionKey, choice, analytics, marketing } = parsed.data;
  // Consent is tied to the signed first-party session — no forged sessionKeys
  if (!(await verifyTrackingSession(c.req.raw, sessionKey))) {
    return fail(c, "Invalid tracking session", 403);
  }
  const ua = c.req.header("user-agent") ?? "";
  await recordConsent(sessionKey, choice, analytics ?? false, marketing ?? false, ua, c.req.raw.headers);
  return ok(c, { recorded: true });
});
