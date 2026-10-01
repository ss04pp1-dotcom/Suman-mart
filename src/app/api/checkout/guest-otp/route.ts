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
//
// Round-5 audit additions:
//   • A DAILY per-email cap — the 10-minute windows (per IP and per email)
//     bounded request RATE, but an attacker rotating IPs could keep one
//     address at its per-email ceiling indefinitely. The daily cap is the
//     hard bound on mail-bombing: one address can never receive more than
//     10 code mails per day, whatever the source IPs.
//   • The response now tells the truth about delivery. `sent` used to be
//     unconditionally true; if the provider just failed, the buyer was sent
//     looking for a code that never arrived. `sent:false` lets the UI offer
//     "retry, or continue without an email". Three consecutive failures
//     trip the outage breaker (src/lib/mailer.ts) and the gate relaxes
//     automatically — no operator intervention, no env hand-editing.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);

  const body = await req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email("Enter a valid email address") }).safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid email", 422);
  const email = parsed.data.email.toLowerCase().trim();

  if (!guestCheckoutOtpRequired()) {
    return fail("Email verification codes are not required right now", 400, { code: "OTP_NOT_REQUIRED" });
  }

  // Three-dimensional throttling: per IP (rotating IPs still hit the email
  // limits), per EMAIL per 10 minutes, and per EMAIL per DAY — the spam
  // target itself is bounded on both timescales, so an attacker cannot use
  // the endpoint to flood one address, rotate addresses from one IP, or
  // sustain the per-email ceiling past the daily cap.
  const rlIp = await ipRateLimit("guest-otp", 5, 10 * 60_000, req);
  if (!rlIp.ok) {
    return fail("Too many code requests. Please wait a few minutes.", 429);
  }
  const rlEmail = await rateLimit(`guest-otp-email:${email}`, 3, 10 * 60_000);
  if (!rlEmail.ok) {
    return fail("A code was recently sent to this email. Please wait a few minutes.", 429);
  }
  const rlEmailDaily = await rateLimit(`guest-otp-daily:${email}`, 10, 24 * 60 * 60_000);
  if (!rlEmailDaily.ok) {
    return fail("Daily code limit reached for this email — try again tomorrow, or leave the email field empty to continue without a confirmation.", 429);
  }

  const code = await issueGuestOtp(email);
  const general = await getSetting("general");
  const delivery = await sendMail({
    to: email,
    subject: `${general.storeName} — your checkout code`,
    body: guestOtpMailBody(code, general.storeName),
  });

  if (!delivery.delivered) {
    // Honest response: the code WAS issued (it can still be used if it turns
    // up), but no mail left the server. The buyer may retry shortly or
    // continue without an email confirmation; repeated failures relax the
    // OTP gate automatically via the outage breaker.
    return ok({ sent: false, reason: "PROVIDER_UNAVAILABLE", expiresInMinutes: 10 });
  }
  return ok({ sent: true, expiresInMinutes: 10 });
}
