import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { ipRateLimit } from "@/lib/rate-limit";
import { redeemAuthToken, createAuthToken, invalidateAuthTokens, EMAIL_VERIFY_TTL } from "@/lib/auth-tokens";
import { getCustomerSession } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";
import { emailDeliveryConfigured } from "@/lib/email-gate";
import { absoluteUrl } from "@/lib/site";
import { z } from "zod";

const schema = z.object({ token: z.string().min(20) });

/** Redeem a verification token. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("verify-email", 10, 15 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Invalid verification link", 422);

  const customerId = await redeemAuthToken("EMAIL_VERIFY", parsed.data.token);
  if (!customerId) return fail("This verification link is invalid or has expired.", 422);

  await db.customer.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
  return ok({ verified: true });
}

/** Resend a verification email for the signed-in customer. */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const session = await getCustomerSession();
  if (!session) return fail("Authentication required", 401);

  const customer = await db.customer.findUnique({ where: { id: session.id } });
  if (!customer) return fail("Account not found", 404);
  if (customer.emailVerifiedAt) return fail("Your email is already verified", 422);

  // Without a mail provider the message can never be delivered — answer
  // honestly instead of pretending a link was sent (the outbox copy has the
  // one-time token redacted, so it is not usable for verification either).
  if (!emailDeliveryConfigured()) {
    return fail("Email delivery is not configured on this store yet — verification is optional for now.", 422, { code: "MAIL_NOT_CONFIGURED" });
  }

  await invalidateAuthTokens("EMAIL_VERIFY", customer.id);
  const token = await createAuthToken("EMAIL_VERIFY", customer.id, EMAIL_VERIFY_TTL);
  void sendMail({
    to: customer.email,
    subject: "Verify your email — ShopNest",
    body: `Hi ${customer.name},\n\nConfirm your email address:\n\n${absoluteUrl(`/verify-email?token=${token}`)}\n\nThe link is valid for 48 hours.\n\n— ShopNest`,
  });
  return ok({ sent: true });
}
