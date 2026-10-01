import { describe, it, expect } from "vitest";
import { redactMailBody, orderConfirmationMail } from "@/lib/mailer";
import { siteUrl, absoluteUrl } from "@/lib/site";

describe("mail body redaction (outbox must never store one-time tokens)", () => {
  it("masks token query params in reset links", () => {
    const body = `Hi Ayesha,\n\nReset your password:\n\n${siteUrl()}/reset-password?token=AbCdEf123456789_-XyZ987654321\n\nThanks`;
    const redacted = redactMailBody(body);
    expect(redacted).not.toContain("AbCdEf123456789_-XyZ987654321");
    expect(redacted).toContain("token=[REDACTED]");
    // the base URL survives for debugging
    expect(redacted).toContain("/reset-password");
  });

  it("masks tokens in verification links", () => {
    const redacted = redactMailBody(`${siteUrl()}/verify-email?token=0123456789abcdef0123456789abcdef`);
    expect(redacted).toBe(`${siteUrl()}/verify-email?token=[REDACTED]`);
  });

  it("leaves ordinary order emails intact", () => {
    const mail = orderConfirmationMail({
      orderNumber: "SN100123",
      customerName: "Rahim",
      total: 1250,
      items: [{ name: "Green Tea", quantity: 2, total: 900 }],
    });
    expect(redactMailBody(mail.body)).toBe(mail.body);
    expect(mail.body).not.toMatch(/track-order\?order=[^ ]*$/); // no relative link
    expect(mail.body).toContain(absoluteUrl("/track-order?order=SN100123"));
  });

  it("ignores short values that cannot be real tokens", () => {
    const body = "Your code=12345 in the app";
    expect(redactMailBody(body)).toBe(body);
  });
});
