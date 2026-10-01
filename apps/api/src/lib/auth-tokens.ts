// One-time tokens for customer account flows (password reset, email
// verification). Ported from the storefront — the raw token travels only
// inside the emailed link; the database stores its SHA-256 hash, so a leaked
// database cannot be replayed.
//
// Port note: Node's crypto (createHash/randomBytes) is replaced by Web Crypto
// (crypto.subtle.digest / getRandomValues) — identical digests and entropy.

import { db } from "@/lib/db";

export type AuthTokenKind = "PASSWORD_RESET" | "EMAIL_VERIFY";

export const PASSWORD_RESET_TTL = 60 * 60 * 1000; // 1 hour
export const EMAIL_VERIFY_TTL = 48 * 60 * 60 * 1000; // 48 hours

async function hashToken(raw: string): Promise<string> {
  // Identical digest to the Node original (createHash("sha256").update(raw)) —
  // tokens issued before the migration must still redeem against the same
  // stored hashes. No domain separation, BY DESIGN (compatibility).
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Create a one-time token; returns the RAW token (for the email link). */
export async function createAuthToken(kind: AuthTokenKind, customerId: string, ttlMs: number): Promise<string> {
  const raw = randomToken();
  await db.authToken.create({
    data: {
      kind,
      customerId,
      tokenHash: await hashToken(raw),
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
  const tokenHash = await hashToken(raw);
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
