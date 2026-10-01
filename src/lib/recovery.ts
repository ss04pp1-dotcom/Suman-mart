// ─────────────────────────────────────────────────────────────────────────
// One-time 2FA recovery codes for admin accounts.
//
// Round-3 audit finding: without recovery codes, an admin who loses their
// authenticator device is PERMANENTLY locked out of the console (the TOTP
// secret is encrypted — there is no manual override).
//
// Design:
//  • 8 codes per admin, shown EXACTLY ONCE (at 2FA enable / regeneration)
//  • format XXXX-XXXX-XXXX-XXXX — 16 chars from a transcription-safe
//    alphabet (no I/L/O/0/1) ≈ 80 bits of entropy
//  • stored ONLY as a domain-separated SHA-256 lookup hash — key-free, so
//    rotating session/TOTP secrets never invalidates stored codes, and a
//    database leak reveals nothing usable (80 random bits is far beyond
//    brute-force range for a single-use, rate-limited credential)
//  • consumption is a conditional UPDATE (usedAt IS NULL) — a code can
//    never be spent twice, even under racing requests
// ─────────────────────────────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 8;

// Transcription-safe: visually ambiguous characters removed
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars

/** Generate fresh (uncopied, unhashed) recovery codes. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let raw = "";
    for (const b of bytes) raw += ALPHABET[b % ALPHABET.length];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`);
  }
  return codes;
}

/** Uppercase + strip separators for matching. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Quick shape check before hitting the database. */
export function looksLikeRecoveryCode(raw: string): boolean {
  const n = normalizeRecoveryCode(raw);
  return /^[A-Z0-9]{12,20}$/.test(n);
}

/** Deterministic storage hash (indexed lookup at login). */
export async function recoveryCodeHash(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`shopnest:recovery-code:v1:${normalized}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
