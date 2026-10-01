// Server-side tracking events — ported from apps/storefront
// src/lib/server-events.ts (next/headers → explicit Request).

import type { Context } from "hono";
import { recordServerEvent } from "@/lib/tracking";
import { issueTrackingSession, SESSION_COOKIE } from "@/lib/tracking-session";
import { getCookie } from "@/lib/cookies";

export { SESSION_COOKIE };

// Session key is stored in a signed first-party cookie pair so server events
// (SignUp, Login, Purchase…) can join the browser tracking session.
export async function ensureSessionKey(c: Context): Promise<string> {
  const { sessionKey } = await issueTrackingSession(c);
  return sessionKey;
}

export async function trackServerEvent(
  c: Context,
  event: {
    eventId: string;
    name: string;
    value?: number | null;
    productId?: string | null;
    productName?: string | null;
    quantity?: number | null;
    url?: string | null;
  },
  sessionKey?: string | null
) {
  const key = sessionKey ?? getCookie(c.req.raw, SESSION_COOKIE) ?? null;
  await recordServerEvent(event, { sessionKey: key, headers: c.req.raw.headers });
}
