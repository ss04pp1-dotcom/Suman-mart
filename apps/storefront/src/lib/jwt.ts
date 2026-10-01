// HS256 JWT via Web Crypto — compatible with Node, Edge and Cloudflare Workers runtimes.

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    stringToBytes(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface JwtPayload {
  sub: string;
  role?: string;
  [key: string]: unknown;
  iat: number;
  exp: number;
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  maxAgeSeconds = 60 * 60 * 24 * 7
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + maxAgeSeconds };
  const header = { alg: "HS256", typ: "JWT" };

  const headerB64 = bytesToBase64Url(stringToBytes(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(stringToBytes(JSON.stringify(body)));
  const data = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, stringToBytes(data) as unknown as ArrayBuffer);
  return `${data}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(sigB64) as unknown as ArrayBuffer,
      stringToBytes(`${headerB64}.${payloadB64}`) as unknown as ArrayBuffer
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as JwtPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ── Plain HMAC signing (cookie value signatures) ───────────────────

/** Sign an arbitrary message with HMAC-SHA256 → base64url signature. */
export async function signHMAC(message: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, stringToBytes(message) as unknown as ArrayBuffer);
  return bytesToBase64Url(new Uint8Array(sig));
}

/** Constant-time-ish HMAC verification. */
export async function verifyHMAC(message: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signHMAC(message, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
