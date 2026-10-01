// E2E helper: compute the CURRENT TOTP code for a known secret.
// Read-only utility — safe by construction (no database access).
//
// Inline RFC 6238/4226 implementation, byte-identical to
// apps/api/src/lib/totp.ts (base32 decode → HMAC-SHA1 → dynamic truncation,
// 30-second step, 6 digits). Duplicated here because the storefront no
// longer carries the TOTP library — it belongs to the Workers API now.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
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

async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes as BufferSource));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

async function generateTotp(secretBase32: string, atMs = Date.now()): Promise<string> {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / 30));
}

const secret = process.argv[2];
if (!secret) {
  console.error("usage: bun tests/e2e/totp-code.ts <base32-secret>");
  process.exit(1);
}
console.log(await generateTotp(secret, Date.now()));

export {};
