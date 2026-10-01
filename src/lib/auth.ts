import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { signJWT, verifyJWT } from "@/lib/jwt";

export const CUSTOMER_COOKIE = "sn_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface CustomerSession {
  id: string;
  name: string;
  email: string;
  tokenVersion: number;
}

export async function createCustomerSession(customer: { id: string; name: string; email: string; tokenVersion?: number }) {
  const token = await signJWT(
    { sub: customer.id, name: customer.name, email: customer.email, typ: "customer", tv: customer.tokenVersion ?? 0 },
    process.env.SESSION_SECRET!
  );
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroyCustomerSession() {
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Resolve the customer session AND verify it against the database:
 *  • account must still exist and be active
 *  • tokenVersion must match (password change / deactivation revokes old tokens)
 */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJWT(token, process.env.SESSION_SECRET!);
  if (!payload || payload.typ !== "customer") return null;

  const customer = await db.customer.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, isActive: true, tokenVersion: true },
  });
  if (!customer || !customer.isActive) return null;
  if (customer.tokenVersion !== (typeof payload.tv === "number" ? payload.tv : 0)) return null;

  return { id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion };
}

export async function getCurrentCustomer() {
  const session = await getCustomerSession();
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
