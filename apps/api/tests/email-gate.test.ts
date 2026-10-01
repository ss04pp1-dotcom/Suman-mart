import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { emailDeliveryConfigured, reviewVerificationEnforced } from "@/lib/email-gate";
import { testEnv } from "./helpers";

// Policy matrix for the round-3 verification fix:
//  • checkout NEVER gates (tested by absence of the gate in the route — the
//    helper file documents the policy; the runtime behaviour is covered by
//    the E2E suite)
//  • reviews gate ONLY while a mail provider is configured (verification is
//    impossible without one — the old behaviour deadlocked new accounts)
//
// Env is manipulated through testEnv() — the accessor the app's lib code
// actually reads (see tests/helpers.ts): bare `process.env` writes in test
// files are invisible to the worker's libs.
describe("email verification policy (round 3)", () => {
  beforeAll(() => {
    const env = testEnv();
    delete env.RESEND_API_KEY;
    delete env.REQUIRE_VERIFIED_EMAIL;
  });

  afterEach(() => {
    const env = testEnv();
    delete env.RESEND_API_KEY;
    delete env.REQUIRE_VERIFIED_EMAIL;
  });

  it("detects whether mail delivery is possible at all", () => {
    const env = testEnv();
    delete env.RESEND_API_KEY;
    expect(emailDeliveryConfigured()).toBe(false);
    env.RESEND_API_KEY = "re_test_key";
    expect(emailDeliveryConfigured()).toBe(true);
  });

  it("does NOT require verified email when no mail provider is configured", () => {
    const env = testEnv();
    delete env.RESEND_API_KEY;
    env.REQUIRE_VERIFIED_EMAIL = "1";
    expect(reviewVerificationEnforced()).toBe(false); // impossible → not enforced
  });

  it("requires verified email for reviews when delivery works", () => {
    const env = testEnv();
    env.RESEND_API_KEY = "re_test_key";
    delete env.REQUIRE_VERIFIED_EMAIL;
    expect(reviewVerificationEnforced()).toBe(true);
  });

  it("can be explicitly disabled even with a provider configured", () => {
    const env = testEnv();
    env.RESEND_API_KEY = "re_test_key";
    env.REQUIRE_VERIFIED_EMAIL = "0";
    expect(reviewVerificationEnforced()).toBe(false);
  });
});
