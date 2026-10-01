// Customer sessions — ported from apps/storefront src/lib/auth.ts.
//
// Same JWT design (HS256, tokenVersion revocation, DB-verified per request);
// cookies are written as raw Set-Cookie headers on the Hono response instead
// of through next/headers. Cookie attributes are IDENTICAL (HttpOnly,
// SameSite=Lax, Secure in production, Path=/, 7-day max-age) so the browser
// experience is unchanged through the storefront proxy.

import type { Context } from "hono";
import { db } from "@/lib/db";
import { signJWT, verifyJWT } from "@/lib/jwt";
import { serializeCookie, getCookie } from "@/lib/cookies";
import { runtimeEnv } from "@/lib/config";

export const CUSTOMER_COOKIE = "sn_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface CustomerSession {
  id: string;
  name: string;
  email: string;
  tokenVersion: number;
}

function secureCookies(): boolean {
  return runtimeEnv().NODE_ENV === "production";
}

export async function createCustomerSession(
  c: Context,
  customer: { id: string; name: string; email: string; tokenVersion?: number }
) {
  const token = await signJWT(
    { sub: customer.id, name: customer.name, email: customer.email, typ: "customer", tv: customer.tokenVersion ?? 0 },
    runtimeEnv().SESSION_SECRET!
  );
  c.header(
    "Set-Cookie",
    serializeCookie(CUSTOMER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: MAX_AGE,
    }),
    { append: true }
  );
}

export async function destroyCustomerSession(c: Context) {
  c.header(
    "Set-Cookie",
    serializeCookie(CUSTOMER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 }),
    { append: true }
  );
}

/**
 * Resolve the customer session AND verify it against the database:
 *  • account must still exist and be active
 *  • tokenVersion must match (password change / deactivation revokes old tokens)
 */
export async function getCustomerSession(req: Request): Promise<CustomerSession | null> {
  const token = getCookie(req, CUSTOMER_COOKIE);
  if (!token) return null;
  const payload = await verifyJWT(token, runtimeEnv().SESSION_SECRET!);
  if (!payload || payload.typ !== "customer") return null;

  const customer = await db.customer.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, isActive: true, tokenVersion: true },
  });
  if (!customer || !customer.isActive) return null;
  if (customer.tokenVersion !== (typeof payload.tv === "number" ? payload.tv : 0)) return null;

  return { id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion };
}

export async function getCurrentCustomer(req: Request) {
  const session = await getCustomerSession(req);
  if (!session) return null;
  return db.customer.findFirst({
    where: { id: session.id, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      createdAt: true,
      emailVerifiedAt: true,
      addresses: true,
    },
  });
}
