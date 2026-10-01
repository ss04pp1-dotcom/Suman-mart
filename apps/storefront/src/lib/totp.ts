// RFC 6238 TOTP (Time-based One-Time Password) with HMAC-SHA1 via Web Crypto.
// No external dependencies — works in Node, Edge and Workers runtimes.
// Used for admin two-factor authentication (opt-in per account).
//
// Secret-at-rest: secrets are stored ENCRYPTED (AES-256-GCM) with a
// VERSIONED key derivation:
//   v1:<iv>:<ct>  key = SHA-256 chain from ADMIN_SESSION_SECRET (legacy —
//                  rotating that secret invalidated every admin's 2FA)
//   v2:<iv>:<ct>  key = SHA-256 chain from the DEDICATED TOTP_ENC_KEY
//                  (round-3 audit: ADMIN_SESSION_SECRET can now rotate
//                  freely; only rotating TOTP_ENC_KEY re-enrolls 2FA)
// v1 rows still decrypt and are transparently upgraded to the current
// format on the next successful use. Legacy plaintext secrets (pre-encryption
// rows) still verify and are upgraded the same way.

// ── Secret encryption (AES-256-GCM, versioned key derivation) ──────

const ENC_PREFIX_V1 = "v1:";
const ENC_PREFIX_V2 = "v2:";
const KEY_INFO = "shopnest:totp-encryption:v1";

function activeEncPrefix(): string {
  return totpKeySecret() === TOTP_ENC_KEY_SENTINEL ? ENC_PREFIX_V2 : ENC_PREFIX_V1;
}

/** Sentinel-free marker: when TOTP_ENC_KEY is configured we write v2 rows. */
const TOTP_ENC_KEY_SENTINEL = "__totp_enc_key__";

function totpKeySecret(): string {
  const dedicated = process.env.TOTP_ENC_KEY ?? "";
  if (dedicated.length >= 32) return TOTP_ENC_KEY_SENTINEL;
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

function actualKeyMaterial(): string {
  const dedicated = process.env.TOTP_ENC_KEY ?? "";
  if (dedicated.length >= 32) return dedicated;
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

let fallbackWarned = false;

async function encryptionKey(material: string): Promise<CryptoKey> {
  const secret = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", secret);
  const seed = new Uint8Array(digest);
  // Simple domain-separated expansion (HKDF-lite): SHA-256(secret ‖ info ‖ counter)
  const info = new TextEncoder().encode(KEY_INFO);
  const input = new Uint8Array(seed.length + info.length + 1);
  input.set(seed, 0);
  input.set(info, seed.length);
  input[input.length - 1] = 1;
  const keyBytes = await crypto.subtle.digest("SHA-256", input);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function keyMaterialFor(prefix: string): string {
  if (prefix === ENC_PREFIX_V2) {
    const dedicated = process.env.TOTP_ENC_KEY ?? "";
    return dedicated.length >= 32 ? dedicated : ""; // fail-closed if key removed
  }
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encrypt a base32 TOTP secret for storage (current key version). */
export async function encryptTotpSecret(secretBase32: string): Promise<string> {
  if (!process.env.TOTP_ENC_KEY && !fallbackWarned) {
    fallbackWarned = true;
    console.warn(
      "[totp] TOTP_ENC_KEY is not set — deriving the encryption key from ADMIN_SESSION_SECRET. " +
        "Set a dedicated TOTP_ENC_KEY (openssl rand -hex 32) so rotating the session secret cannot break 2FA."
    );
  }
  const key = await encryptionKey(actualKeyMaterial());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(secretBase32);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return activeEncPrefix() + toB64Url(iv) + ":" + toB64Url(new Uint8Array(ct));
}

/** Decrypt a stored secret. Legacy plaintext rows pass through unchanged. */
export async function decryptTotpSecret(stored: string): Promise<string> {
  let prefix = ENC_PREFIX_V1;
  let payload = stored;
  if (stored.startsWith(ENC_PREFIX_V2)) {
    prefix = ENC_PREFIX_V2;
    payload = stored.slice(ENC_PREFIX_V2.length);
  } else if (stored.startsWith(ENC_PREFIX_V1)) {
    payload = stored.slice(ENC_PREFIX_V1.length);
  } else {
    return stored; // legacy plaintext
  }
  try {
    const [ivPart, ctPart] = payload.split(":");
    if (!ivPart || !ctPart) return stored;
    const material = keyMaterialFor(prefix);
    const key = await encryptionKey(material);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64Url(ivPart) },
      key,
      fromB64Url(ctPart)
    );
    return new TextDecoder().decode(pt);
  } catch {
    console.error("[totp] secret decryption failed (was TOTP_ENC_KEY / ADMIN_SESSION_SECRET rotated?)");
    return ""; // force verification failure rather than falling back to ciphertext
  }
}

/** True when a stored secret should be re-encrypted to the current version. */
export function needsTotpSecretUpgrade(stored: string): boolean {
  if (!stored) return false;
  if (process.env.TOTP_ENC_KEY && process.env.TOTP_ENC_KEY.length >= 32) {
    return !stored.startsWith(ENC_PREFIX_V2); // plaintext or v1 → upgrade to v2
  }
  return !stored.startsWith(ENC_PREFIX_V1); // no dedicated key → at least v1
}

export function isEncryptedTotpSecret(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX_V1) || stored.startsWith(ENC_PREFIX_V2);
}

// ── Base32 (RFC 4648, no padding) ─────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ── HMAC-SHA1 ─────────────────────────────────────────────────────

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message as unknown as ArrayBuffer);
  return new Uint8Array(sig);
}

// ── TOTP core ─────────────────────────────────────────────────────

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;

/** HOTP (RFC 4226) — TOTP's building block. */
export async function hotp(secret: Uint8Array, counter: number, digits = DEFAULT_DIGITS): Promise<string> {
  const counterBytes = new Uint8Array(8);
  // 64-bit big-endian counter (safe — counter < 2^53)
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = await hmacSha1(secret, counterBytes);
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Generate a TOTP code for the given unix time (mainly for tests). */
export async function generateTotp(secretBase32: string, atMs = Date.now()): Promise<string> {
  const secret = base32Decode(secretBase32);
  return hotp(secret, Math.floor(atMs / 1000 / DEFAULT_STEP_SECONDS));
}

/**
 * Verify a TOTP code (async — Web Crypto), accepting ±1 time step of clock
 * drift. Returns the MATCHED STEP so callers can enforce replay protection
 * (reject steps ≤ the last one consumed). Comparison is length-checked then
 * constant-time-ish over characters.
 */
export async function verifyTotpStep(secretBase32: string, code: string, atMs = Date.now(), window = 1): Promise<number | null> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / DEFAULT_STEP_SECONDS);
  for (let drift = -window; drift <= window; drift++) {
    const step = counter + drift;
    const expected = await hotp(secret, step);
    if (expected.length !== normalized.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ normalized.charCodeAt(i);
    if (diff === 0) return step;
  }
  return null;
}

/** Boolean convenience wrapper (no replay tracking — see verifyTotpStep). */
export async function verifyTotp(secretBase32: string, code: string, atMs = Date.now(), window = 1): Promise<boolean> {
  return (await verifyTotpStep(secretBase32, code, atMs, window)) !== null;
}

/** Generate a new random 160-bit TOTP secret (base32). */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** otpauth:// URI for authenticator apps (render as QR / manual entry). */
export function totpUri(secretBase32: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
