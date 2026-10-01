// ─────────────────────────────────────────────────────────────────────────
// Email verification policy.
//
// Round-3 audit finding (two defects in the previous gate):
//   1. Trivially bypassable — a blocked unverified customer could simply
//      log out and place the same order as a guest with any email address.
//   2. A deadlock without a mail provider: when RESEND_API_KEY is unset the
//      verification mail is queued to the outbox with the one-time token
//      REDACTED (an account-takeover guard), so it can never be delivered —
//      a newly registered customer could NEVER verify and NEVER buy.
//
// Policy (deliberate; documented in README → Security model):
//   • Checkout: NO verification gate. Signed-in and guest buyers are treated
//     identically — the email is captured either way for confirmations, and
//     the shipping phone is the primary fulfillment contact in a COD-first
//     store. Rate limits and order review are the fraud controls.
//     (Round-5: the guest email itself is now OPTIONAL — many Bangladeshi
//     COD buyers have no email at all. A guest who gives no email simply
//     gets no confirmation mail; the OTP is only demanded from a guest who
//     DOES submit an email, i.e. exactly when the platform would otherwise
//     send mail to an unproven address.)
//   • Reviews: verification IS required — but only while a mail provider is
//     configured, i.e. while verification is actually possible. Setting
//     REQUIRE_VERIFIED_EMAIL=0 disables it explicitly.
// ─────────────────────────────────────────────────────────────────────────

import { mailProviderHealthy } from "@/lib/mailer";
import { runtimeEnv } from "@/lib/config";

/** True when transactional mail can actually be delivered (Resend configured). */
export function emailDeliveryConfigured(): boolean {
  return Boolean(runtimeEnv().RESEND_API_KEY);
}

/** True when reviews should require a verified email address. */
export function reviewVerificationEnforced(): boolean {
  return emailDeliveryConfigured() && runtimeEnv().REQUIRE_VERIFIED_EMAIL !== "0";
}

/**
 * True when GUEST checkout must prove email ownership via a one-time code
 * (round-4 audit: without it anyone could place orders with someone else's
 * email and have the platform send that person unsolicited confirmation
 * mail). Three conditions, all of which must hold:
 *   • Mail provider configured — the ONLY situation in which unsolicited
 *     mail can actually be sent, i.e. the only abuse case.
 *   • Provider HEALTHY (round-5): a Resend outage no longer deadlocks guest
 *     orders. After 3 consecutive failed deliveries the gate relaxes
 *     automatically for 10 minutes — during an outage no mail can leave the
 *     server, so there is nothing to abuse (see src/lib/mailer.ts).
 *   • Not explicitly disabled via REQUIRE_GUEST_EMAIL_OTP=0 (e.g. while
 *     migrating).
 * A guest who submits NO email is never asked for a code (round-5): no
 * email → no mail → no abuse vector; the checkout route enforces this.
 */
export function guestCheckoutOtpRequired(): boolean {
  return (
    emailDeliveryConfigured() &&
    mailProviderHealthy() &&
    runtimeEnv().REQUIRE_GUEST_EMAIL_OTP !== "0"
  );
}
