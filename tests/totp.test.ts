import { describe, it, expect } from "vitest";
import { base32Encode, base32Decode, generateTotp, verifyTotp, generateTotpSecret, totpUri } from "@/lib/totp";

describe("TOTP (RFC 6238 / RFC 4648)", () => {
  it("base32 round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 255, 128, 64]);
    const encoded = base32Encode(bytes);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect([...base32Decode(encoded)]).toEqual([...bytes]);
  });

  it("base32 matches the RFC 4648 test vectors", () => {
    expect(base32Encode(new TextEncoder().encode("f"))).toBe("MY");
    expect(base32Encode(new TextEncoder().encode("fo"))).toBe("MZXQ");
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
  });

  it("generates a 6-digit code that verifies", async () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const code = await generateTotp(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(await verifyTotp(secret, code)).toBe(true);
  });

  it("accepts a code from the previous time step (±1 window)", async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const previousStepCode = await generateTotp(secret, now - 30_000);
    expect(await verifyTotp(secret, previousStepCode, now)).toBe(true);
  });

  it("rejects codes outside the drift window", async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const farCode = await generateTotp(secret, now - 5 * 30_000);
    expect(await verifyTotp(secret, farCode, now)).toBe(false);
  });

  it("rejects malformed codes outright", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotp(secret, "12345")).toBe(false);
    expect(await verifyTotp(secret, "abcdef")).toBe(false);
    expect(await verifyTotp(secret, "")).toBe(false);
  });

  it("builds a valid otpauth:// URI", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "admin@shopnest.com", "ShopNest Admin");
    expect(uri.startsWith("otpauth://totp/ShopNest%20Admin:admin%40shopnest.com?secret=JBSWY3DPEHPK3PXP")).toBe(true);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
