import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────
// One-time tokens for customer account flows (password reset, email
// verification). The raw token travels only inside the emailed link; the
// database stores its SHA-256 hash, so a leaked database cannot be replayed.
// ─────────────────────────────────────────────────────────────────────────

export type AuthTokenKind = "PASSWORD_RESET" | "EMAIL_VERIFY";

export const PASSWORD_RESET_TTL = 60 * 60 * 1000; // 1 hour
export const EMAIL_VERIFY_TTL = 48 * 60 * 60 * 1000; // 48 hours

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Create a one-time token; returns the RAW token (for the email link). */
export async function createAuthToken(kind: AuthTokenKind, customerId: string, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.authToken.create({
    data: {
      kind,
      customerId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

/**
 * Redeem a token (single use, race-safe). The read is followed by a CONDITIONAL
 * update (`WHERE usedAt IS NULL`) — when two concurrent requests present the
 * same token, exactly one gets count=1; the loser sees count=0 and is rejected.
 */
export async function redeemAuthToken(kind: AuthTokenKind, raw: string): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const row = await db.authToken.findUnique({ where: { tokenHash } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;

  const redeem = await db.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return redeem.count === 1 ? row.customerId : null;
}

/** Invalidate all outstanding tokens of a kind for a customer. */
export async function invalidateAuthTokens(kind: AuthTokenKind, customerId: string) {
  await db.authToken.deleteMany({ where: { kind, customerId, usedAt: null } }).catch(() => undefined);
}
