import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Round-4 audit: guest checkout email OTP.
//
// Policy (src/lib/email-gate.ts): guests must prove control of the email
// they checkout with — but ONLY while a mail provider is configured (the
// only situation in which unsolicited mail can actually be sent).
//
// Mechanics (src/lib/guest-otp.ts): 6-digit code, SHA-256-hashed at rest,
// 10-minute TTL, 5 wrong entries burn the code, single-use via atomic
// conditional update, re-issuing supersedes previous live codes.
// ─────────────────────────────────────────────────────────────────────────

const TEST_DB = path.resolve(__dirname, "../db/test-checkout.db");

beforeAll(() => {
  // Idempotent schema sync (checkout.test.ts may or may not have run first —
  // files execute sequentially, see vitest.config.ts).
  execSync(`bunx prisma db push --skip-generate`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
});

import { db } from "@/lib/db";
import { issueGuestOtp, consumeGuestOtp, guestOtpMailBody, GUEST_OTP_MAX_ATTEMPTS } from "@/lib/guest-otp";
import { guestCheckoutOtpRequired, emailDeliveryConfigured } from "@/lib/email-gate";
import {
  redactMailBody,
  mailProviderHealthy,
  recordMailOutcome,
  MAIL_OUTAGE_COOLDOWN_MS,
  __resetMailHealthForTests,
  __setMailHealthForTests,
} from "@/lib/mailer";

const EMAIL = "guest-buyer@example.com";

async function cleanup() {
  await db.guestEmailOtp.deleteMany({ where: { email: EMAIL } }).catch(() => undefined);
}

describe("guest checkout OTP policy (round 4)", () => {
  const original = { ...process.env };

  beforeEach(() => __resetMailHealthForTests()); // breaker state must not leak across tests

  afterEach(() => {
    for (const key of ["RESEND_API_KEY", "REQUIRE_GUEST_EMAIL_OTP"] as const) {
      if (key in original) process.env[key] = original[key];
      else delete process.env[key];
    }
    __resetMailHealthForTests();
  });

  it("is NOT required without a mail provider (no mail leaves the server → nothing to abuse)", () => {
    delete process.env.RESEND_API_KEY;
    process.env.REQUIRE_GUEST_EMAIL_OTP = "1";
    expect(emailDeliveryConfigured()).toBe(false);
    expect(guestCheckoutOtpRequired()).toBe(false);
  });

  it("IS required while a mail provider is configured", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_GUEST_EMAIL_OTP;
    expect(guestCheckoutOtpRequired()).toBe(true);
  });

  it("can be explicitly disabled even with a provider configured", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.REQUIRE_GUEST_EMAIL_OTP = "0";
    expect(guestCheckoutOtpRequired()).toBe(false);
  });
});

describe("guest checkout OTP policy — provider outage breaker (round 5)", () => {
  // Round-5 audit: “Resend down → every guest order blocked; the only way out
  // was hand-editing REQUIRE_GUEST_EMAIL_OTP=0”. The breaker makes the gate
  // relax automatically after consecutive delivery failures, and re-arm
  // after a cooldown probe — no operator intervention.
  const original = { ...process.env };

  beforeEach(() => __resetMailHealthForTests());

  afterEach(() => {
    for (const key of ["RESEND_API_KEY", "REQUIRE_GUEST_EMAIL_OTP"] as const) {
      if (key in original) process.env[key] = original[key];
      else delete process.env[key];
    }
    __resetMailHealthForTests();
  });

  it("stays required while the provider is configured AND delivering", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_GUEST_EMAIL_OTP;
    recordMailOutcome(true);
    expect(mailProviderHealthy()).toBe(true);
    expect(guestCheckoutOtpRequired()).toBe(true);
  });

  it("relaxes automatically after 3 consecutive failed deliveries", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_GUEST_EMAIL_OTP;
    recordMailOutcome(false);
    recordMailOutcome(false);
    expect(guestCheckoutOtpRequired()).toBe(true); // 2 failures: still up
    recordMailOutcome(false); // 3rd → outage
    expect(mailProviderHealthy()).toBe(false);
    expect(guestCheckoutOtpRequired()).toBe(false); // automatic fallback — orders flow again
  });

  it("allows exactly one probe after the cooldown, then re-trips on failure", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_GUEST_EMAIL_OTP;
    __setMailHealthForTests({
      consecutiveFailures: 3,
      lastFailureAt: Date.now() - (MAIL_OUTAGE_COOLDOWN_MS + 60_000),
    });
    expect(mailProviderHealthy()).toBe(true); // probe allowed through
    expect(guestCheckoutOtpRequired()).toBe(true);
    recordMailOutcome(false); // the probe failed — re-trip immediately
    expect(mailProviderHealthy()).toBe(false);
    expect(guestCheckoutOtpRequired()).toBe(false);
  });

  it("a single successful delivery resets the breaker entirely", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_GUEST_EMAIL_OTP;
    recordMailOutcome(false);
    recordMailOutcome(false);
    recordMailOutcome(false); // outage
    recordMailOutcome(true); // one success clears it
    expect(mailProviderHealthy()).toBe(true);
    expect(guestCheckoutOtpRequired()).toBe(true);
  });

  it("an outage while no provider is configured is simply “not required”", () => {
    delete process.env.RESEND_API_KEY;
    expect(mailProviderHealthy()).toBe(false);
    expect(guestCheckoutOtpRequired()).toBe(false);
  });
});

describe("guest checkout OTP mechanics (round 4)", () => {
  afterEach(cleanup);

  it("issues a 6-digit code and accepts it exactly once", async () => {
    const code = await issueGuestOtp(EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    expect(await consumeGuestOtp(EMAIL, code)).toEqual({ ok: true });
    // single-use: the same code cannot fund a second order
    expect(await consumeGuestOtp(EMAIL, code)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("stores only a hash — the code is not recoverable from the database", async () => {
    const code = await issueGuestOtp(EMAIL);
    const rows = await db.guestEmailOtp.findMany({ where: { email: EMAIL } });
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toContain(code);
    expect(rows[0].codeHash).toHaveLength(64); // sha-256 hex
  });

  it("rejects a wrong code and burns an attempt", async () => {
    const code = await issueGuestOtp(EMAIL);
    const wrong = code === "000000" ? "000001" : "000000";
    expect(await consumeGuestOtp(EMAIL, wrong)).toEqual({ ok: false, reason: "INVALID" });
    const row = await db.guestEmailOtp.findFirstOrThrow({ where: { email: EMAIL } });
    expect(row.attempts).toBe(1);
    // the correct code still works while attempts remain
    expect(await consumeGuestOtp(EMAIL, code)).toEqual({ ok: true });
  });

  it("invalidates the code after too many wrong entries", async () => {
    const code = await issueGuestOtp(EMAIL);
    const wrong = [...Array(10).keys()].map((d) => String(d).repeat(6)).find((c) => c !== code);
    for (let i = 0; i < GUEST_OTP_MAX_ATTEMPTS; i++) {
      expect(await consumeGuestOtp(EMAIL, wrong)).toEqual({ ok: false, reason: "INVALID" });
    }
    // even the CORRECT code is now refused
    expect(await consumeGuestOtp(EMAIL, code)).toEqual({ ok: false, reason: "TOO_MANY_ATTEMPTS" });
  });

  it("burns attempts ATOMICALLY under concurrency — the cap is never exceeded (round 5)", async () => {
    // Round-5 audit: the old read-check-write let concurrent wrong entries
    // race around the cap check. The conditional UPDATE must be the arbiter:
    // 10 concurrent wrong entries against a 5-attempt cap produce exactly
    // 5 INVALIDs and 5 TOO_MANY_ATTEMPTS, and the stored count is exactly 5.
    let code = await issueGuestOtp(EMAIL);
    while (code === "000000") code = await issueGuestOtp(EMAIL); // 1-in-10⁶ guard: the “wrong” guess must stay wrong
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeGuestOtp(EMAIL, "000000"))
    );
    const invalid = results.filter((r) => !r.ok && r.reason === "INVALID");
    const capped = results.filter((r) => !r.ok && r.reason === "TOO_MANY_ATTEMPTS");
    expect(invalid).toHaveLength(GUEST_OTP_MAX_ATTEMPTS);
    expect(capped).toHaveLength(10 - GUEST_OTP_MAX_ATTEMPTS);
    const row = await db.guestEmailOtp.findFirstOrThrow({ where: { email: EMAIL } });
    expect(row.attempts).toBe(GUEST_OTP_MAX_ATTEMPTS);
  });

  it("supersedes previous live codes when re-issuing", async () => {
    const first = await issueGuestOtp(EMAIL);
    const second = await issueGuestOtp(EMAIL);
    expect(await consumeGuestOtp(EMAIL, first)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(await consumeGuestOtp(EMAIL, second)).toEqual({ ok: true });
  });

  it("refuses non-6-digit input without touching the database", async () => {
    await issueGuestOtp(EMAIL);
    expect(await consumeGuestOtp(EMAIL, "12345")).toEqual({ ok: false, reason: "MISSING" });
    expect(await consumeGuestOtp(EMAIL, "abcdef")).toEqual({ ok: false, reason: "MISSING" });
  });

  it("matches the email case-insensitively (checkout normalizes to lower case)", async () => {
    const code = await issueGuestOtp("Mixed.Case@Example.COM");
    expect(await consumeGuestOtp("mixed.case@example.com", code)).toEqual({ ok: true });
  });

  it("expires old codes", async () => {
    const code = await issueGuestOtp(EMAIL);
    await db.guestEmailOtp.updateMany({
      where: { email: EMAIL },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeGuestOtp(EMAIL, code)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("redacts the OTP in stored mail bodies (outbox leak safety)", () => {
    const body = guestOtpMailBody("482913");
    expect(body).toContain("482913");
    const redacted = redactMailBody(body);
    expect(redacted).not.toContain("482913");
    expect(redacted).toContain("[REDACTED]");
  });
});
