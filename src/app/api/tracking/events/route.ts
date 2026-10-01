import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { ingestEvents, maybeRunRetention } from "@/lib/tracking";
import { trackingEventSchema } from "@/lib/validators";
import { ipRateLimit } from "@/lib/rate-limit";
import { verifyTrackingSession } from "@/lib/tracking-session";

export async function POST(req: NextRequest) {
  // Signed-session + rate limited collector for storefront beacons:
  //  • the payload sessionKey must match the HMAC-signed cookie pair
  //  • Purchase events are SERVER-ONLY (recorded from checkout) — browser
  //    copies are dropped here so revenue can never be faked from a client
  const rl = await ipRateLimit("track", 120, 60_000, req);
  if (!rl.ok) return fail("Rate limit exceeded", 429);

  const body = await req.json().catch(() => null);
  const parsed = trackingEventSchema.safeParse(body);
  if (!parsed.success) return fail("Invalid tracking payload", 422);

  const { session, events } = parsed.data;

  if (!(await verifyTrackingSession(session.sessionKey))) {
    return fail("Invalid tracking session", 403);
  }

  // Purchase is authoritative only from the server (checkout pipeline)
  const safeEvents = events.filter((e) => e.name !== "Purchase");

  const result = await ingestEvents(req, session, safeEvents, "BROWSER");
  if (result.quotaExceeded) return fail("Event quota exceeded for this session", 429);

  // Opportunistic retention cleanup (throttled internally)
  void maybeRunRetention().catch(() => undefined);

  return ok(result);
}
