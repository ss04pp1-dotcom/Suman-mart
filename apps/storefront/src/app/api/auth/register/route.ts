import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { createCustomerSession } from "@/lib/auth";
import { registerSchema } from "@/lib/validators";
import { ipRateLimit } from "@/lib/rate-limit";
import { trackServerEvent } from "@/lib/server-events";
import { createAuthToken, EMAIL_VERIFY_TTL } from "@/lib/auth-tokens";
import { sendMail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("register", 5, 60 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input", 422);
  }
  const { name, email, phone, password } = parsed.data;

  const existing = await db.customer.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return fail("An account with this email already exists", 409);

  const customer = await db.customer.create({
    data: { name, email: email.toLowerCase(), phone, passwordHash: await hashPassword(password) },
  });

  await createCustomerSession({ id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion });

  // Email verification (non-blocking; required before checkout/reviews)
  const verifyToken = await createAuthToken("EMAIL_VERIFY", customer.id, EMAIL_VERIFY_TTL);
  const mail = {
    to: customer.email,
    subject: "Verify your email — ShopNest",
    body: `Hi ${customer.name},\n\nWelcome to ShopNest! Confirm your email address:\n\n${absoluteUrl(`/verify-email?token=${verifyToken}`)}\n\nThe link is valid for 48 hours.\n\n— ShopNest`,
  };
  void sendMail(mail);

  // SignUp tracking event (joins the browser session via the sn_sk cookie)
  await trackServerEvent({
    eventId: `signup_${customer.id}_${Date.now()}`,
    name: "SignUp",
    url: "/register",
  });

  return ok({ id: customer.id, name: customer.name, email: customer.email });
}
