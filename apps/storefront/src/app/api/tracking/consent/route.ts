import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { recordConsent } from "@/lib/tracking";
import { consentSchema } from "@/lib/validators";
import { ipRateLimit } from "@/lib/rate-limit";
import { verifyTrackingSession } from "@/lib/tracking-session";

export async function POST(req: NextRequest) {
  const rl = await ipRateLimit("consent", 30, 60_000, req);
  if (!rl.ok) return fail("Rate limit exceeded", 429);

  const body = await req.json().catch(() => null);
  const parsed = consentSchema.safeParse(body);
  if (!parsed.success) return fail("Invalid consent payload", 422);

  const { sessionKey, choice, analytics, marketing } = parsed.data;
  // Consent is tied to the signed first-party session — no forged sessionKeys
  if (!(await verifyTrackingSession(sessionKey))) {
    return fail("Invalid tracking session", 403);
  }
  const ua = req.headers.get("user-agent") ?? "";
  await recordConsent(sessionKey, choice, analytics ?? false, marketing ?? false, ua, req.headers);
  return ok({ recorded: true });
}
