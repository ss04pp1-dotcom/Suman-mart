import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/password";
import { createCustomerSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";
import { rateLimit, ipRateLimit } from "@/lib/rate-limit";
import { trackServerEvent } from "@/lib/server-events";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("login", 10, 15 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return fail("Enter a valid email and password", 422);

  // Per-EMAIL lockout: brute-force attempts against one account are throttled
  // even when the attacker rotates IPs (forged XFF / botnets).
  const emailLock = await rateLimit(`login-email:${parsed.data.email.toLowerCase()}`, 20, 15 * 60_000);
  if (!emailLock.ok) return fail("Too many attempts on this account. Please try again later.", 429);

  const customer = await db.customer.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!customer || !customer.isActive || !(await verifyPassword(parsed.data.password, customer.passwordHash))) {
    return fail("Invalid email or password", 401);
  }

  // Transparent upgrade of outdated password hashes (e.g. 100k → 600k iterations)
  if (needsRehash(customer.passwordHash)) {
    await db.customer
      .update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(parsed.data.password) } })
      .catch(() => undefined);
  }

  await createCustomerSession({ id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion });
  await trackServerEvent({ eventId: `login_${customer.id}_${Date.now()}`, name: "Login", url: "/login" });

  return ok({ id: customer.id, name: customer.name, email: customer.email, emailVerified: Boolean(customer.emailVerifiedAt) });
}
