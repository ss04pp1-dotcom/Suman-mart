import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptTotpSecret,
  decryptTotpSecret,
  isEncryptedTotpSecret,
  needsTotpSecretUpgrade,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  verifyTotpStep,
} from "@/lib/totp";
import { testEnv } from "./helpers";

// Env is manipulated through testEnv() — the accessor the app's lib code
// actually reads (see tests/helpers.ts): bare `process.env` writes in test
// files are invisible to the worker's libs. The vitest bindings define a
// TOTP_ENC_KEY by default; the "at rest" suite explicitly clears it so the
// legacy v1 path (key derived from ADMIN_SESSION_SECRET) is exercised.
describe("TOTP secret encryption at rest", () => {
  beforeAll(() => {
    const env = testEnv();
    delete env.TOTP_ENC_KEY;
    env.ADMIN_SESSION_SECRET = "totp-v1-test-secret-0123456789abcdef";
  });

  it("round-trips a secret", async () => {
    const secret = generateTotpSecret();
    const stored = await encryptTotpSecret(secret);
    expect(stored).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(secret); // ciphertext only
    expect(isEncryptedTotpSecret(stored)).toBe(true);
    expect(await decryptTotpSecret(stored)).toBe(secret);
  });

  it("uses a fresh IV per encryption (identical secrets → different ciphertexts)", async () => {
    const secret = generateTotpSecret();
    const a = await encryptTotpSecret(secret);
    const b = await encryptTotpSecret(secret);
    expect(a).not.toBe(b);
    expect(await decryptTotpSecret(a)).toBe(secret);
    expect(await decryptTotpSecret(b)).toBe(secret);
  });

  it("passes legacy plaintext secrets through for transparent migration", async () => {
    const legacy = generateTotpSecret();
    expect(isEncryptedTotpSecret(legacy)).toBe(false);
    expect(await decryptTotpSecret(legacy)).toBe(legacy);
  });

  it("fails closed when the key cannot decrypt (rotated ADMIN_SESSION_SECRET)", async () => {
    const env = testEnv();
    const secret = generateTotpSecret();
    const stored = await encryptTotpSecret(secret);
    const previous = env.ADMIN_SESSION_SECRET;
    env.ADMIN_SESSION_SECRET = "a-completely-different-secret-0123456789";
    try {
      expect(await decryptTotpSecret(stored)).toBe("");
    } finally {
      env.ADMIN_SESSION_SECRET = previous;
    }
  });
});

describe("TOTP secret encryption — dedicated TOTP_ENC_KEY (round 3)", () => {
  it("writes v2 rows and round-trips them while TOTP_ENC_KEY is set", async () => {
    const env = testEnv();
    const previous = env.TOTP_ENC_KEY;
    env.TOTP_ENC_KEY = "dedicated-totp-key-0123456789abcdef0123456789";
    try {
      const secret = generateTotpSecret();
      const stored = await encryptTotpSecret(secret);
      expect(stored).toMatch(/^v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
      expect(await decryptTotpSecret(stored)).toBe(secret);
      // v2 rows survive ADMIN_SESSION_SECRET rotation (the audit's complaint)
      const prevSession = env.ADMIN_SESSION_SECRET;
      env.ADMIN_SESSION_SECRET = "rotated-session-secret-9876543210abcdef";
      try {
        expect(await decryptTotpSecret(stored)).toBe(secret);
      } finally {
        env.ADMIN_SESSION_SECRET = prevSession;
      }
      // …and flag older formats for transparent upgrade
      expect(needsTotpSecretUpgrade(stored)).toBe(false);
      expect(needsTotpSecretUpgrade("plaintextsecret")).toBe(true);
    } finally {
      env.TOTP_ENC_KEY = previous;
    }
  });

  it("still decrypts legacy v1 rows while TOTP_ENC_KEY is set (upgrade path)", async () => {
    const env = testEnv();
    // v1 row encrypted under ADMIN_SESSION_SECRET (no dedicated key yet)
    delete env.TOTP_ENC_KEY;
    env.ADMIN_SESSION_SECRET = "totp-v1-test-secret-0123456789abcdef";
    const secret = generateTotpSecret();
    const v1Row = await encryptTotpSecret(secret);
    expect(v1Row).toMatch(/^v1:/);
    env.TOTP_ENC_KEY = "dedicated-totp-key-0123456789abcdef0123456789";
    try {
      expect(await decryptTotpSecret(v1Row)).toBe(secret); // still readable
      expect(needsTotpSecretUpgrade(v1Row)).toBe(true); // and flagged for upgrade
    } finally {
      delete env.TOTP_ENC_KEY;
    }
  });

  it("fails closed for v2 rows when TOTP_ENC_KEY is removed", async () => {
    const env = testEnv();
    env.TOTP_ENC_KEY = "dedicated-totp-key-0123456789abcdef0123456789";
    const secret = generateTotpSecret();
    const stored = await encryptTotpSecret(secret);
    delete env.TOTP_ENC_KEY;
    try {
      expect(await decryptTotpSecret(stored)).toBe("");
    } finally {
      env.TOTP_ENC_KEY = "dedicated-totp-key-0123456789abcdef0123456789";
    }
  });
});

describe("TOTP replay protection", () => {
  it("returns the matched step so callers can reject reuse", async () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000; // fixed time
    const code = await generateTotp(secret, at);
    const step = await verifyTotpStep(secret, code, at);
    expect(step).toBe(Math.floor(at / 1000 / 30));
    // Same code verifies again at the same step (caller must guard reuse)…
    expect(await verifyTotpStep(secret, code, at + 5000)).not.toBeNull();
    // …but the guard semantics are: step <= lastStep must be rejected.
    const lastStep = step!;
    expect((await verifyTotpStep(secret, code, at + 5000))! <= lastStep).toBe(true);
    // A later code maps to a strictly newer step
    const nextCode = await generateTotp(secret, at + 31_000);
    expect((await verifyTotpStep(secret, nextCode, at + 31_000))!).toBeGreaterThan(lastStep);
  });

  it("still rejects wrong codes outright", async () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const real = await generateTotp(secret, at);
    const wrong = real === "000000" ? "000001" : `000000`;
    expect(await verifyTotpStep(secret, wrong, at, 0)).toBeNull();
    expect(await verifyTotpStep(secret, "12ab34", at)).toBeNull(); // non-numeric
    expect(await verifyTotp(secret, "12345", at)).toBe(false); // wrong length
  });
});
