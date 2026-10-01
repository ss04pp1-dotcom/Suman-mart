import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, needsRehash, hashIterations } from "@/lib/password";

describe("password hashing (PBKDF2-SHA256)", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("S3cure!Passw0rd");
    expect(hash.startsWith("pbkdf2$600000$")).toBe(true);
    expect(await verifyPassword("S3cure!Passw0rd", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", hash)).toBe(false);
  });

  it("produces unique salts (different hashes for the same password)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toEqual(b);
  });

  it("flags legacy 100k-iteration hashes for rehash", async () => {
    const legacy = "pbkdf2$100000$c2FsdHNhbHRzYWx0c2FsdA==$" + "A".repeat(44);
    expect(hashIterations(legacy)).toBe(100000);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("anything"))).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$12$abc$def")).toBe(false);
    expect(hashIterations("not-a-hash")).toBe(0);
  });
});
