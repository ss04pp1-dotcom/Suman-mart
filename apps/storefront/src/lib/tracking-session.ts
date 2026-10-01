import { cookies } from "next/headers";
import { signHMAC, verifyHMAC } from "@/lib/jwt";

// ─────────────────────────────────────────────────────────────────────────
// Signed tracking sessions.
//
// The public event collector only accepts payloads whose sessionKey matches
// an HMAC-signed cookie pair issued by this server (`sn_sk` + `sn_sks`).
// Without it anyone could POST fabricated events (incl. fake revenue) and
// poison analytics. Purchase events are additionally server-only — the
// browser copy is dropped by the collector (it only feeds browser pixels).
// ─────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "sn_sk";
export const SESSION_SIG_COOKIE = "sn_sks";
const MAX_AGE = 180 * 24 * 60 * 60; // 180 days

function newSessionKey(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

/** Verify that a posted sessionKey matches the signed cookie pair. */
export async function verifyTrackingSession(sessionKey: string): Promise<boolean> {
  if (!sessionKey || sessionKey.length < 8) return false;
  const store = await cookies();
  const key = store.get(SESSION_COOKIE)?.value;
  const sig = store.get(SESSION_SIG_COOKIE)?.value;
  if (!key || !sig || key !== sessionKey) return false;
  return verifyHMAC(key, sig, process.env.SESSION_SECRET!);
}

/** Issue (or return the existing) signed session; sets both cookies. */
export async function issueTrackingSession(): Promise<{ sessionKey: string; created: boolean }> {
  const store = await cookies();
  const key = store.get(SESSION_COOKIE)?.value;
  const sig = store.get(SESSION_SIG_COOKIE)?.value;

  if (key && sig && (await verifyHMAC(key, sig, process.env.SESSION_SECRET!))) {
    return { sessionKey: key, created: false };
  }

  const sessionKey = newSessionKey();
  const signature = await signHMAC(sessionKey, process.env.SESSION_SECRET!);
  store.set(SESSION_COOKIE, sessionKey, {
    httpOnly: false, // the browser client reads the key to echo it in payloads
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  store.set(SESSION_SIG_COOKIE, signature, {
    httpOnly: true, // the signature itself is never readable from JS
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return { sessionKey, created: true };
}
