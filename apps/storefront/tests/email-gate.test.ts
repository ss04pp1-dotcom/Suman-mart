import { describe, it, expect, afterEach } from "vitest";
import { emailDeliveryConfigured, reviewVerificationEnforced } from "@/lib/email-gate";

// Policy matrix for the round-3 verification fix:
//  • checkout NEVER gates (tested by absence of the gate in the route — the
//    helper file documents the policy; the runtime behaviour is covered by
//    the E2E suite)
//  • reviews gate ONLY while a mail provider is configured (verification is
//    impossible without one — the old behaviour deadlocked new accounts)
describe("email verification policy (round 3)", () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of ["RESEND_API_KEY", "REQUIRE_VERIFIED_EMAIL"] as const) {
      if (key in original) process.env[key] = original[key];
      else delete process.env[key];
    }
  });

  it("detects whether mail delivery is possible at all", () => {
    delete process.env.RESEND_API_KEY;
    expect(emailDeliveryConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_test_key";
    expect(emailDeliveryConfigured()).toBe(true);
  });

  it("does NOT require verified email when no mail provider is configured", () => {
    delete process.env.RESEND_API_KEY;
    process.env.REQUIRE_VERIFIED_EMAIL = "1";
    expect(reviewVerificationEnforced()).toBe(false); // impossible → not enforced
  });

  it("requires verified email for reviews when delivery works", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.REQUIRE_VERIFIED_EMAIL;
    expect(reviewVerificationEnforced()).toBe(true);
  });

  it("can be explicitly disabled even with a provider configured", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.REQUIRE_VERIFIED_EMAIL = "0";
    expect(reviewVerificationEnforced()).toBe(false);
  });
});
