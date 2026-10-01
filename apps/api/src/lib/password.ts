// PBKDF2-SHA256 password hashing via Web Crypto — runtime agnostic (Node/Edge/Workers).
//
// Current default: 600,000 iterations (OWASP 2023+ guidance for PBKDF2-SHA256).
// Older hashes (100k) still verify — the iteration count is embedded in the
// stored string and `needsRehash` lets login routes upgrade them transparently.

const ITERATIONS = 600_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const bytes = new Uint8Array(bits);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomSalt();
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${hash}`;
}

/** Parse the iteration count out of a stored hash (0 for malformed entries). */
export function hashIterations(stored: string): number {
  const [scheme, iterations, , hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !hash) return 0;
  const n = parseInt(iterations, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when the stored hash uses an outdated work factor and should be re-hashed on next successful login. */
export function needsRehash(stored: string): boolean {
  return hashIterations(stored) < ITERATIONS;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterations, saltB64, expectedHash] = stored.split("$");
    if (scheme !== "pbkdf2" || !expectedHash) return false;
    const iter = parseInt(iterations, 10);
    if (!Number.isFinite(iter) || iter <= 0) return false;
    const actual = await derive(password, fromB64(saltB64), iter);
    // Constant-time-ish comparison
    if (actual.length !== expectedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) {
      diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
