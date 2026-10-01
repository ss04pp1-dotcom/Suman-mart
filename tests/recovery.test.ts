import { describe, it, expect } from "vitest";
import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  looksLikeRecoveryCode,
  recoveryCodeHash,
  RECOVERY_CODE_COUNT,
} from "@/lib/recovery";

describe("2FA recovery codes (round 3)", () => {
  it("generates the full set in XXXX-XXXX-XXXX-XXXX shape", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      // transcription-safe alphabet: no I, L, O, 0, 1
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it("never generates duplicate codes", () => {
    const many = [...generateRecoveryCodes(200), ...generateRecoveryCodes(200)];
    expect(new Set(many).size).toBe(many.length);
  });

  it("normalizes separators and case for matching", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jklm-npqr")).toBe("ABCDEFGHJKLMNPQR");
    expect(normalizeRecoveryCode(" abcd efgh.jklm,npqr ")).toBe("ABCDEFGHJKLMNPQR");
    expect(normalizeRecoveryCode("AbCdEfGhJkLmNpQr")).toBe("ABCDEFGHJKLMNPQR");
  });

  it("shape-checks inputs before a database lookup", () => {
    expect(looksLikeRecoveryCode("ABCD-EFGH-JKLM-NPQR")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false); // that's a TOTP code
    expect(looksLikeRecoveryCode("short")).toBe(false);
    expect(looksLikeRecoveryCode("")).toBe(false);
  });

  it("hashes deterministically (indexed lookup) without storing the code", async () => {
    const a = await recoveryCodeHash(normalizeRecoveryCode("ABCD-EFGH-JKLM-NPQR"));
    const b = await recoveryCodeHash(normalizeRecoveryCode("abcd-efgh.jklm,npqr")); // same code, typed differently
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    const c = await recoveryCodeHash(normalizeRecoveryCode("ABCD-EFGH-JKLM-NPQS")); // different code
    expect(c).not.toBe(a);
    // The formatted code never appears in the hash input/output relationship
    expect(a).not.toContain("ABCD");
  });
});
