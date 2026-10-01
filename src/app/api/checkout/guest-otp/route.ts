import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { ipRateLimit, rateLimit } from "@/lib/rate-limit";
import { guestCheckoutOtpRequired } from "@/lib/email-gate";
import { issueGuestOtp, guestOtpMailBody } from "@/lib/guest-otp";
import { sendMail } from "@/lib/mailer";
import { getSetting } from "@/lib/settings";
import { z } from "zod";

// Round-4 audit: guests must prove control of the email they give at checkout
// (otherwise the store is an open "send unsolicited mail to arbitrary
// addresses" service). This endpoint issues the one-time code; the checkout
// API verifies it. Only available while a mail provider is configured.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);

  const body = await req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email("Enter a valid email address") }).safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid email", 422);
  const email = parsed.data.email.toLowerCase().trim();

  if (!guestCheckoutOtpRequired()) {
    return fail("Email verification codes are not required right now", 400, { code: "OTP_NOT_REQUIRED" });
  }

  // Two-dimensional throttling: per IP (rotating IPs still hit the email
  // limit) and per EMAIL (the spam target itself) — an attacker cannot use
  // the endpoint to flood one address, nor rotate addresses from one IP.
  const rlIp = await ipRateLimit("guest-otp", 5, 10 * 60_000, req);
  if (!rlIp.ok) {
    return fail("Too many code requests. Please wait a few minutes.", 429);
  }
  const rlEmail = await rateLimit(`guest-otp-email:${email}`, 3, 10 * 60_000);
  if (!rlEmail.ok) {
    return fail("A code was recently sent to this email. Please wait a few minutes.", 429);
  }

  const code = await issueGuestOtp(email);
  const general = await getSetting("general");
  void sendMail({
    to: email,
    subject: `${general.storeName} — your checkout code`,
    body: guestOtpMailBody(code, general.storeName),
  });

  return ok({ sent: true, expiresInMinutes: 10 });
}
