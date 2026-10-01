import { createHash, randomInt } from "crypto";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────
// One-time email OTP for GUEST checkout (round-4 audit).
//
// Finding: guests could place orders with ANY email address and the platform
// would happily send that address an "order confirmation" — a third party
// could weaponize the store as a spam/mailer service. Checkout rate limits
// were the only backstop.
//
// Fix: while a mail provider is configured (the only situation in which mail
// can actually be sent — and therefore the only situation with a spam
// vector), guests must prove control of the email via a 6-digit OTP before
// the order (and its confirmation mail) is accepted. Without a provider no
// mail leaves the server, so no OTP is required (and none could be delivered
// anyway).
//
// Storage: only the SHA-256 hash of the code is stored; wrong entries are
// counted per code (5 misses invalidate); codes expire in 10 minutes and are
// single-use (atomic conditional update). A database leak reveals nothing
// usable, and concurrent redemptions of one code produce exactly one winner.
// ─────────────────────────────────────────────────────────────────────────

export const GUEST_OTP_TTL = 10 * 60 * 1000; // 10 minutes
export const GUEST_OTP_MAX_ATTEMPTS = 5;

function hashCode(email: string, code: string): string {
  // Email is mixed into the hash so the same 6-digit code issued to two
  // different addresses never shares a hash (hardens against replay across
  // identities and makes the hash space per-buyer).
  return createHash("sha256").update(`${email.toLowerCase()}::${code}`).digest("hex");
}

/**
 * Hash of (email, code) exactly as stored — exported for E2E tooling that
 * needs to inject a KNOWN code into the sandbox database. Production code
 * paths use issueGuestOtp/consumeGuestOtp.
 */
export function guestOtpHashFor(email: string, code: string): string {
  return hashCode(email, code);
}

/** Generate a random 6-digit code (uniform, crypto-based). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue an OTP for an email address. Returns the RAW code (for the mail) —
 * only its hash is stored. Outstanding unused codes for the same email are
 * invalidated so at most one live code exists per address.
 */
export async function issueGuestOtp(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const code = generateOtp();
  await db.$transaction([
    // Supersede previous live codes for this email
    db.guestEmailOtp.updateMany({
      where: { email: normalized, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    }),
    db.guestEmailOtp.create({
      data: {
        email: normalized,
        codeHash: hashCode(normalized, code),
        expiresAt: new Date(Date.now() + GUEST_OTP_TTL),
      },
    }),
  ]);
  // Opportunistic cleanup of dead rows (issued > 1 day ago)
  db.guestEmailOtp
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } })
    .catch(() => undefined);
  return code;
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "MISSING" | "INVALID" | "EXPIRED" | "TOO_MANY_ATTEMPTS" };

/**
 * Verify AND consume a guest OTP (single use, race-safe).
 *
 * Lookup is hash-first: a code that MATCHES a row but is spent/superseded/
 * expired answers "EXPIRED" (request a new one) — it is only ever counted as
 * a wrong entry ("INVALID") when it matches no row at all, so a stale code
 * from an earlier "Send code" click never burns the attempts of the current
 * live code. The 6th wrong entry invalidates the code entirely.
 */
export async function consumeGuestOtp(email: string, code: string): Promise<OtpResult> {
  const normalized = email.toLowerCase().trim();
  const clean = code.replace(/\D/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, reason: "MISSING" };
  const hash = hashCode(normalized, clean);

  // 1) Exact hash match (any row state) — distinguishes stale from wrong.
  const exact = await db.guestEmailOtp.findFirst({
    where: { email: normalized, codeHash: hash },
    orderBy: { createdAt: "desc" },
  });
  if (exact) {
    if (exact.consumedAt) return { ok: false, reason: "EXPIRED" }; // used or superseded
    if (exact.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };
    if (exact.attempts >= GUEST_OTP_MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
    // Atomic single-use claim — two concurrent checkouts with the same code
    // produce exactly one winner.
    const claim = await db.guestEmailOtp.updateMany({
      where: { id: exact.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claim.count === 1 ? { ok: true } : { ok: false, reason: "EXPIRED" };
  }

  // 2) No hash match → a wrong code: burn one attempt on the current live row.
  const live = await db.guestEmailOtp.findFirst({
    where: { email: normalized, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!live) return { ok: false, reason: "EXPIRED" }; // nothing live to verify against
  if (live.attempts >= GUEST_OTP_MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  await db.guestEmailOtp.update({
    where: { id: live.id },
    data: { attempts: { increment: 1 } },
  });
  return { ok: false, reason: "INVALID" };
}

/** Build the plain-text OTP mail body (kept here so tests can assert on it). */
export function guestOtpMailBody(code: string, storeName = "ShopNest"): string {
  return (
    `Your ${storeName} verification code is: ${code}\n\n` +
    `Enter this code at checkout to confirm this email address. ` +
    `The code expires in 10 minutes and can be used once.\n\n` +
    `If you did not request this, you can ignore this message — ` +
    `no order has been placed and nothing was charged.`
  );
}
