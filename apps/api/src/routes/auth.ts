// Customer authentication endpoints — Hono port of
// apps/storefront/src/app/api/auth/* (7 routes). Behaviour, validation,
// rate limits, cookies and responses are identical; only the session
// helpers now take the Hono context / raw request explicitly.

import { Hono } from "hono";
import type { Env } from "../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/password";
import { createCustomerSession, destroyCustomerSession, getCurrentCustomer, getCustomerSession } from "@/lib/auth";
import { loginSchema, registerSchema } from "@/lib/validators";
import { rateLimit, ipRateLimit } from "@/lib/rate-limit";
import { trackServerEvent } from "@/lib/server-events";
import { createAuthToken, redeemAuthToken, invalidateAuthTokens, PASSWORD_RESET_TTL, EMAIL_VERIFY_TTL } from "@/lib/auth-tokens";
import { sendMail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";
import { emailDeliveryConfigured } from "@/lib/email-gate";
import { z } from "zod";
import { runtimeEnv } from "@/lib/config";

export const authApi = new Hono<{ Bindings: Env }>();

// POST /v1/auth/login
authApi.post("/login", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("login", 10, 15 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many attempts. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return fail(c, "Enter a valid email and password", 422);

  // Per-EMAIL lockout: brute-force attempts against one account are throttled
  // even when the attacker rotates IPs (forged XFF / botnets).
  const emailLock = await rateLimit(`login-email:${parsed.data.email.toLowerCase()}`, 20, 15 * 60_000);
  if (!emailLock.ok) return fail(c, "Too many attempts on this account. Please try again later.", 429);

  const customer = await db.customer.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!customer || !customer.isActive || !(await verifyPassword(parsed.data.password, customer.passwordHash))) {
    return fail(c, "Invalid email or password", 401);
  }

  // Transparent upgrade of outdated password hashes (e.g. 100k → 600k iterations)
  if (needsRehash(customer.passwordHash)) {
    await db.customer
      .update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(parsed.data.password) } })
      .catch(() => undefined);
  }

  await createCustomerSession(c, { id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion });
  await trackServerEvent(c, { eventId: `login_${customer.id}_${Date.now()}`, name: "Login", url: "/login" });

  return ok(c, { id: customer.id, name: customer.name, email: customer.email, emailVerified: Boolean(customer.emailVerifiedAt) });
});

// POST /v1/auth/register
authApi.post("/register", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("register", 5, 60 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many attempts. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.issues[0]?.message ?? "Invalid input", 422);
  }
  const { name, email, phone, password } = parsed.data;

  const existing = await db.customer.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return fail(c, "An account with this email already exists", 409);

  const customer = await db.customer.create({
    data: { name, email: email.toLowerCase(), phone, passwordHash: await hashPassword(password) },
  });

  await createCustomerSession(c, { id: customer.id, name: customer.name, email: customer.email, tokenVersion: customer.tokenVersion });

  // Email verification (non-blocking; required before checkout/reviews)
  const verifyToken = await createAuthToken("EMAIL_VERIFY", customer.id, EMAIL_VERIFY_TTL);
  const mail = {
    to: customer.email,
    subject: "Verify your email — ShopNest",
    body: `Hi ${customer.name},\n\nWelcome to ShopNest! Confirm your email address:\n\n${absoluteUrl(`/verify-email?token=${verifyToken}`)}\n\nThe link is valid for 48 hours.\n\n— ShopNest`,
  };
  void sendMail(mail);

  // SignUp tracking event (joins the browser session via the sn_sk cookie)
  await trackServerEvent(c, {
    eventId: `signup_${customer.id}_${Date.now()}`,
    name: "SignUp",
    url: "/register",
  });

  return ok(c, { id: customer.id, name: customer.name, email: customer.email });
});

// POST /v1/auth/logout
authApi.post("/logout", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  await destroyCustomerSession(c);
  return ok(c, { loggedOut: true });
});

// GET /v1/auth/me
authApi.get("/me", async (c) => {
  const customer = await getCurrentCustomer(c.req.raw);
  return ok(c, { customer });
});

// POST /v1/auth/forgot
authApi.post("/forgot", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("forgot", 5, 15 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many attempts. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) return fail(c, "Enter a valid email", 422);

  const customer = await db.customer.findUnique({ where: { email: parsed.data.email.toLowerCase() } });

  // Always the same response — never reveal whether the account exists
  if (customer && customer.isActive) {
    // Invalidate outstanding reset links, then issue a fresh one
    await invalidateAuthTokens("PASSWORD_RESET", customer.id);
    const token = await createAuthToken("PASSWORD_RESET", customer.id, PASSWORD_RESET_TTL);
    void sendMail({
      to: customer.email,
      subject: "Reset your password — ShopNest",
      body: `Hi ${customer.name},\n\nWe received a request to reset your ShopNest password. Open the link below to choose a new one (valid for 1 hour):\n\n${absoluteUrl(`/reset-password?token=${token}`)}\n\nIf you did not request this, you can safely ignore this email — your password stays unchanged.\n\n— ShopNest`,
    });
  }

  return ok(c, { message: "If an account exists for that email, a reset link has been sent." });
});

// POST /v1/auth/reset
authApi.post("/reset", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("reset", 10, 15 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many attempts. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      token: z.string().min(20),
      password: z.string().min(8, "Password must be at least 8 characters").max(100),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid reset request", 422);

  const customerId = await redeemAuthToken("PASSWORD_RESET", parsed.data.token);
  if (!customerId) return fail(c, "This reset link is invalid or has expired. Please request a new one.", 422);

  // Password change revokes every active session (tokenVersion bump)
  await db.customer.update({
    where: { id: customerId },
    data: { passwordHash: await hashPassword(parsed.data.password), tokenVersion: { increment: 1 } },
  });

  return ok(c, { message: "Your password has been reset. Please sign in with the new password." });
});

// POST /v1/auth/verify-email — redeem a verification token.
authApi.post("/verify-email", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("verify-email", 10, 15 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many attempts. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ token: z.string().min(20) }).safeParse(body);
  if (!parsed.success) return fail(c, "Invalid verification link", 422);

  const customerId = await redeemAuthToken("EMAIL_VERIFY", parsed.data.token);
  if (!customerId) return fail(c, "This verification link is invalid or has expired.", 422);

  await db.customer.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
  return ok(c, { verified: true });
});

// PUT /v1/auth/verify-email — resend a verification email for the signed-in customer.
authApi.put("/verify-email", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const session = await getCustomerSession(c.req.raw);
  if (!session) return fail(c, "Authentication required", 401);

  const customer = await db.customer.findUnique({ where: { id: session.id } });
  if (!customer) return fail(c, "Account not found", 404);
  if (customer.emailVerifiedAt) return fail(c, "Your email is already verified", 422);

  // Without a mail provider the message can never be delivered — answer
  // honestly instead of pretending a link was sent (the outbox copy has the
  // one-time token redacted, so it is not usable for verification either).
  if (!emailDeliveryConfigured()) {
    return fail(c, "Email delivery is not configured on this store yet — verification is optional for now.", 422, "MAIL_NOT_CONFIGURED");
  }

  await invalidateAuthTokens("EMAIL_VERIFY", customer.id);
  const token = await createAuthToken("EMAIL_VERIFY", customer.id, EMAIL_VERIFY_TTL);
  void sendMail({
    to: customer.email,
    subject: "Verify your email — ShopNest",
    body: `Hi ${customer.name},\n\nConfirm your email address:\n\n${absoluteUrl(`/verify-email?token=${token}`)}\n\nThe link is valid for 48 hours.\n\n— ShopNest`,
  });
  return ok(c, { sent: true });
});
