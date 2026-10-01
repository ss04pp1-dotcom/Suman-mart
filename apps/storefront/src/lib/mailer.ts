import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";

// ─────────────────────────────────────────────────────────────────────────
// Transactional email (order confirmations, password resets, verification).
//
// Provider model: when RESEND_API_KEY is configured, mails are delivered via
// the Resend HTTP API (no SDK needed — a single fetch call). Without a
// provider every mail is persisted to the MailOutbox table with status
// PENDING so operators can inspect/replay them and wire a real provider later.
//
// Security: bodies stored in the outbox are REDACTED — one-time tokens
// (password reset / email verification links) are replaced with a placeholder
// so neither a database leak nor an outbox viewer can hijack an account.
// The raw link exists only in the delivered mail (and, in development only,
// on the server console).
// ─────────────────────────────────────────────────────────────────────────

export interface MailMessage {
  to: string;
  subject: string;
  body: string; // plain text or simple HTML
  /** Don't redact (used by tests / non-sensitive mails). */
  skipRedaction?: boolean;
}

// ── Provider health tracking (round-5 audit) ─────────────
// The guest-OTP gate used to key off “a provider is CONFIGURED”, so a Resend
// outage blocked every guest order carrying an email — codes were issued but
// never delivered, and the only way out was hand-editing
// REQUIRE_GUEST_EMAIL_OTP=0. Delivery outcomes are now tracked here: after
// MAIL_OUTAGE_THRESHOLD consecutive failed deliveries the provider is treated
// as DOWN for MAIL_OUTAGE_COOLDOWN_MS and the OTP gate relaxes AUTOMATICALLY
// (during an outage no mail can leave the server, so the anti-spam property
// holds by construction — nothing can be delivered to an address its owner
// does not control). The first attempt after the cooldown re-probes the
// provider; one further failure re-trips the breaker. In-memory only: on the
// single-node SQLite deployment this targets, each process trips
// independently (documented in README → Scaling).

export const MAIL_OUTAGE_THRESHOLD = 3; // consecutive failures → outage
export const MAIL_OUTAGE_COOLDOWN_MS = 10 * 60_000; // then re-probe

interface ProviderHealth {
  consecutiveFailures: number;
  lastFailureAt: number; // 0 = never failed
  lastSuccessAt: number;
}

// globalThis so Next.js dev HMR and the test runner share one view.
const globalForHealth = globalThis as unknown as { snMailerHealth?: ProviderHealth };
const health = (globalForHealth.snMailerHealth ??= {
  consecutiveFailures: 0,
  lastFailureAt: 0,
  lastSuccessAt: 0,
});

/**
 * True when the mail provider is configured AND not in a detected outage.
 * Callers gate “can we currently deliver mail” on this (guest OTP policy —
 * src/lib/email-gate.ts). No provider configured → false by definition.
 */
export function mailProviderHealthy(): boolean {
  if (!process.env.RESEND_API_KEY) return false;
  if (health.consecutiveFailures < MAIL_OUTAGE_THRESHOLD) return true;
  // Outage in effect until the cooldown passes since the LAST failure;
  // then exactly one probe attempt is allowed through.
  return Date.now() - health.lastFailureAt >= MAIL_OUTAGE_COOLDOWN_MS;
}

/** Record a delivery outcome. Success resets the breaker; failure trips it. */
export function recordMailOutcome(delivered: boolean): void {
  if (delivered) {
    health.consecutiveFailures = 0;
    health.lastSuccessAt = Date.now();
  } else {
    health.consecutiveFailures += 1;
    health.lastFailureAt = Date.now();
  }
}

/** Test hook: reset breaker state between test cases. */
export function __resetMailHealthForTests(): void {
  health.consecutiveFailures = 0;
  health.lastFailureAt = 0;
  health.lastSuccessAt = 0;
}

/** Test hook: force breaker state (simulating failures / time travel). */
export function __setMailHealthForTests(state: Partial<ProviderHealth>): void {
  if (state.consecutiveFailures !== undefined) health.consecutiveFailures = state.consecutiveFailures;
  if (state.lastFailureAt !== undefined) health.lastFailureAt = state.lastFailureAt;
  if (state.lastSuccessAt !== undefined) health.lastSuccessAt = state.lastSuccessAt;
}

/** Mask one-time token query params in a mail body before storing it. */
export function redactMailBody(body: string): string {
  // token=… / t=… / code=… style params carrying ≥16 chars of entropy
  let out = body.replace(/([?&](?:token|t|code|key)=)[A-Za-z0-9_-]{16,}/g, "$1[REDACTED]");
  // Standalone one-time 6-digit OTP codes (guest checkout email verification,
  // round-4) — short-lived, but an outbox leak must not reveal a live one.
  out = out.replace(/(code is:?\s*)\d{6}\b/gi, "$1[REDACTED]");
  return out;
}

export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? "ShopNest <onboarding@resend.dev>";
  const storedBody = message.skipRedaction ? message.body : redactMailBody(message.body);

  if (!apiKey) {
    await db.mailOutbox
      .create({
        data: {
          toEmail: message.to,
          subject: message.subject,
          body: storedBody,
          status: "SKIPPED_NO_PROVIDER",
          provider: null,
        },
      })
      .catch((e) => console.error("[mailer] outbox write failed:", e));
    if (process.env.NODE_ENV !== "production") {
      // Development convenience only: the full link (with token) goes to the
      // server console — never to the database.
      console.info(`[mailer:dev] to=${message.to} subject="${message.subject}"
${message.body}`);
    }
    return { delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const error = `Resend HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
      await db.mailOutbox
        .create({ data: { toEmail: message.to, subject: message.subject, body: storedBody, status: "FAILED", provider: "resend", error } })
        .catch(() => undefined);
      console.error("[mailer] send failed:", error);
      recordMailOutcome(false); // round-5: feed the outage breaker
      return { delivered: false };
    }
    await db.mailOutbox
      .create({ data: { toEmail: message.to, subject: message.subject, body: storedBody, status: "SENT", provider: "resend", sentAt: new Date() } })
      .catch(() => undefined);
    recordMailOutcome(true); // round-5: a success clears any outage
    return { delivered: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "network error";
    await db.mailOutbox
      .create({ data: { toEmail: message.to, subject: message.subject, body: storedBody, status: "FAILED", provider: "resend", error } })
      .catch(() => undefined);
    console.error("[mailer] send failed:", error);
    recordMailOutcome(false); // round-5: feed the outage breaker (network path)
    return { delivered: false };
  }
}

// ── Ready-made transactional mails ─────────────────────────────────

interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  total: number;
  items: { name: string; quantity: number; total: number }[];
  estimatedDelivery?: Date | null;
  /** e.g. "cash on delivery" / "bKash (verification pending)" */
  paymentLabel?: string;
}

export function orderConfirmationMail(data: OrderEmailData, storeName = "ShopNest"): MailMessage {
  const items = data.items.map((i) => `  • ${i.name} × ${i.quantity} — ৳${i.total.toLocaleString()}`).join("\n");
  const eta = data.estimatedDelivery
    ? `Estimated delivery: ${data.estimatedDelivery.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}\n`
    : "";
  const payment = data.paymentLabel ? ` (${data.paymentLabel})` : "";
  return {
    to: "", // filled by caller
    subject: `Order ${data.orderNumber} confirmed — ${storeName}`,
    body: `Hi ${data.customerName},\n\nThank you for your order!\n\nOrder: ${data.orderNumber}\n${items}\nTotal: ৳${data.total.toLocaleString()}${payment}\n${eta}\nTrack your order anytime: ${absoluteUrl(`/track-order?order=${data.orderNumber}`)}\n\n— ${storeName}`,
  };
}

export function orderStatusMail(data: { orderNumber: string; customerName: string; status: string; note?: string | null }, storeName = "ShopNest"): MailMessage {
  return {
    to: "",
    subject: `Order ${data.orderNumber} is now ${data.status.replace(/_/g, " ").toLowerCase()} — ${storeName}`,
    body: `Hi ${data.customerName},\n\nYour order ${data.orderNumber} status was updated to: ${data.status.replace(/_/g, " ").toLowerCase()}.\n${data.note ? `Note: ${data.note}\n` : ""}\nTrack it anytime: ${absoluteUrl(`/track-order?order=${data.orderNumber}`)}\n\n— ${storeName}`,
  };
}
