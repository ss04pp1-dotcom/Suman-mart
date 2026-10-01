// Signed tracking sessions — ported from apps/storefront
// src/lib/tracking-session.ts (next/headers → explicit Request/Context).
//
// The public event collector only accepts payloads whose sessionKey matches
// an HMAC-signed cookie pair issued by this server (`sn_sk` + `sn_sks`).
// Without it anyone could POST fabricated events (incl. fake revenue) and
// poison analytics. Purchase events are additionally server-only — the
// browser copy is dropped by the collector (it only feeds browser pixels).

import type { Context } from "hono";
import { signHMAC, verifyHMAC } from "@/lib/jwt";
import { serializeCookie, getCookie } from "@/lib/cookies";
import { runtimeEnv } from "@/lib/config";

export const SESSION_COOKIE = "sn_sk";
export const SESSION_SIG_COOKIE = "sn_sks";
const MAX_AGE = 180 * 24 * 60 * 60; // 180 days

function secureCookies(): boolean {
  return runtimeEnv().NODE_ENV === "production";
}

function newSessionKey(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

/** Verify that a posted sessionKey matches the signed cookie pair. */
export async function verifyTrackingSession(req: Request, sessionKey: string): Promise<boolean> {
  if (!sessionKey || sessionKey.length < 8) return false;
  const key = getCookie(req, SESSION_COOKIE);
  const sig = getCookie(req, SESSION_SIG_COOKIE);
  if (!key || !sig || key !== sessionKey) return false;
  return verifyHMAC(key, sig, runtimeEnv().SESSION_SECRET!);
}

/** Issue (or return the existing) signed session; sets both cookies. */
export async function issueTrackingSession(c: Context): Promise<{ sessionKey: string; created: boolean }> {
  const req = c.req.raw;
  const key = getCookie(req, SESSION_COOKIE);
  const sig = getCookie(req, SESSION_SIG_COOKIE);

  if (key && sig && (await verifyHMAC(key, sig, runtimeEnv().SESSION_SECRET!))) {
    return { sessionKey: key, created: false };
  }

  const sessionKey = newSessionKey();
  const signature = await signHMAC(sessionKey, runtimeEnv().SESSION_SECRET!);
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, sessionKey, {
      httpOnly: false, // the browser client reads the key to echo it in payloads
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: MAX_AGE,
    }),
    { append: true }
  );
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_SIG_COOKIE, signature, {
      httpOnly: true, // the signature itself is never readable from JS
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: MAX_AGE,
    }),
    { append: true }
  );
  return { sessionKey, created: true };
}
