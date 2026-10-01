import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { ipRateLimit } from "@/lib/rate-limit";
import { createAuthToken, invalidateAuthTokens, PASSWORD_RESET_TTL } from "@/lib/auth-tokens";
import { sendMail } from "@/lib/mailer";
import { absoluteUrl } from "@/lib/site";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("forgot", 5, 15 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Enter a valid email", 422);

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

  return ok({ message: "If an account exists for that email, a reset link has been sent." });
}
