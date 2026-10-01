// One-time email OTP for GUEST checkout — ported from apps/storefront
// src/lib/guest-otp.ts. Design unchanged (round-4/round-5 audit behaviour):
// only the SHA-256 hash of (email, code) is stored; wrong entries burn
// attempts atomically; codes expire in 10 minutes and are single-use.
//
// Port notes:
//  • Node crypto (createHash / randomInt) → Web Crypto equivalents.
//  • The two-statement issue path (supersede previous + insert new) ran as a
//    Prisma array transaction; on D1 it is one atomic env.DB.batch — the
//    adapter does not support array transactions.

import { db } from "@/lib/db";
import { sqlDate } from "@/lib/config";

export const GUEST_OTP_TTL = 10 * 60 * 1000; // 10 minutes
export const GUEST_OTP_MAX_ATTEMPTS = 5;

async function hashCode(email: string, code: string): Promise<string> {
  // Email is mixed into the hash so the same 6-digit code issued to two
  // different addresses never shares a hash (hardens against replay across
  // identities and makes the hash space per-buyer). Digest identical to the
  // Node original (sha256 of "<email>::<code>").
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email.toLowerCase()}::${code}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a random 6-digit code (uniform, crypto-based). */
function generateOtp(): string {
  // Rejection sampling for a uniform 0..999999 draw.
  const max = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return String(v % max).padStart(6, "0");
}

function d1(): D1Database {
  const env = (globalThis as unknown as { __apiEnv?: { DB: D1Database } }).__apiEnv;
  if (!env?.DB) throw new Error("guest-otp used before the env bridge ran");
  return env.DB;
}

function cuidLike(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  return `c${time}${rand}${prefix}`;
}

/**
 * Issue an OTP for an email address. Returns the RAW code (for the mail) —
 * only its hash is stored. Outstanding unused codes for the same email are
 * invalidated so at most one live code exists per address.
 */
export async function issueGuestOtp(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const code = generateOtp();
  const now = Date.now();
  await d1().batch([
    // Supersede previous live codes for this email
    d1().prepare(
      `UPDATE "GuestEmailOtp" SET "consumedAt" = ?1 WHERE "email" = ?2 AND "consumedAt" IS NULL AND "expiresAt" > ?3`
    ).bind(sqlDate(now), normalized, sqlDate(now)),
    d1().prepare(
      `INSERT INTO "GuestEmailOtp" ("id", "email", "codeHash", "expiresAt", "attempts", "createdAt")
       VALUES (?1, ?2, ?3, ?4, 0, ?5)`
    ).bind(cuidLike("o"), normalized, await hashCode(normalized, code), sqlDate(now + GUEST_OTP_TTL), sqlDate(now)),
  ]);
  // Opportunistic cleanup of dead rows (issued > 1 day ago)
  d1()
    .prepare(`DELETE FROM "GuestEmailOtp" WHERE "createdAt" < ?1`)
    .bind(sqlDate(now - 24 * 3600 * 1000))
    .run()
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
  const hash = await hashCode(normalized, clean);

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

  // Round-5 audit: the attempt increment must be ATOMIC. This single
  // conditional UPDATE only increments while the cap is unmet — count === 0
  // means the cap is (now) reached, so the response is deterministic even
  // under races.
  const burn = await db.guestEmailOtp.updateMany({
    where: { id: live.id, attempts: { lt: GUEST_OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (burn.count === 0) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
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
