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
//   • Reviews: verification IS required — but only while a mail provider is
//     configured, i.e. while verification is actually possible. Setting
//     REQUIRE_VERIFIED_EMAIL=0 disables it explicitly.
// ─────────────────────────────────────────────────────────────────────────

/** True when transactional mail can actually be delivered (Resend configured). */
export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** True when reviews should require a verified email address. */
export function reviewVerificationEnforced(): boolean {
  return emailDeliveryConfigured() && process.env.REQUIRE_VERIFIED_EMAIL !== "0";
}

/**
 * True when GUEST checkout must prove email ownership via a one-time code
 * (round-4 audit: without it anyone could place orders with someone else's
 * email and have the platform send that person unsolicited confirmation
 * mail). Deliberately mirrors the reviews gate:
 *   • Mail provider configured → OTP required (this is the ONLY situation in
 *     which unsolicited mail can actually be sent, i.e. the only abuse case).
 *   • No provider → no mail ever leaves the server, so there is nothing to
 *     abuse and no OTP could be delivered anyway.
 * REQUIRE_GUEST_EMAIL_OTP=0 disables it explicitly (e.g. while migrating).
 */
export function guestCheckoutOtpRequired(): boolean {
  return emailDeliveryConfigured() && process.env.REQUIRE_GUEST_EMAIL_OTP !== "0";
}
