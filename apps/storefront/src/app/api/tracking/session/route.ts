import { ok, fail } from "@/lib/api";
import { ipRateLimit } from "@/lib/rate-limit";
import { issueTrackingSession } from "@/lib/tracking-session";
import type { NextRequest } from "next/server";

/**
 * Issues the signed, first-party tracking session (sn_sk + sn_sks cookies).
 * Called once by the storefront tracking client when no valid pair exists.
 * Purely anonymous — a random key; nothing is recorded until the visitor
 * grants consent. Rate limited so scripts cannot farm fresh sessions to
 * dodge the per-session event quota.
 */
export async function GET(req: NextRequest) {
  const rl = await ipRateLimit("track-session", 30, 60_000, req);
  if (!rl.ok) return fail("Rate limit exceeded", 429);
  const { sessionKey } = await issueTrackingSession();
  return ok({ sessionKey });
}
