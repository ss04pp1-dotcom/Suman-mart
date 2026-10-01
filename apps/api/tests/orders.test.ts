import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

async function track(orderNumber: string, phone: string) {
  const res = await SELF.fetch("http://localhost/v1/orders/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNumber, phone }),
  });
  return { res, body: (await res.json()) as any };
}

describe("POST /v1/orders/track", () => {
  it("returns the order + items + timeline when number AND phone match", async () => {
    const { res, body } = await track("SN100001", "01711111111");
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const o = body.data;
    expect(o.orderNumber).toBe("SN100001");
    expect(o.status).toBe("SHIPPED");
    expect(o.paymentStatus).toBe("PAID");
    expect(o.paymentMethod).toBe("BKASH");
    expect(o.total).toBe(3760);
    expect(o.courier).toBe("Steadfast");
    expect(o.trackingNumber).toBe("TRK-1");
    expect(o.items).toHaveLength(2);
    expect(o.items[0].name).toBe("Wireless Earbuds Pro");
    expect(o.items[0].options).toEqual({ Color: "Black" }); // parsed JSON, not a string
    expect(o.items[1].options).toBeNull();
    expect(o.statusHistory.map((h: any) => h.status)).toEqual(["PENDING", "CONFIRMED", "SHIPPED"]);
  });

  it("matches case-insensitively on the order number", async () => {
    const { res } = await track("sn100001", "01711111111");
    expect(res.status).toBe(200);
  });

  it("matches on the LAST 10 digits of the phone (parity with the storefront)", async () => {
    const { res } = await track("SN100001", "+8801711111111");
    expect(res.status).toBe(200);
  });

  it("hides the order when the phone does not match", async () => {
    const { res, body } = await track("SN100001", "01822222222");
    expect(res.status).toBe(404);
    // identical message for wrong-phone and unknown-order: no enumeration
    expect(body.error).toBe("No order found with this number and phone combination");
  });

  it("404s unknown order numbers with the same message", async () => {
    const { res, body } = await track("SN999999", "01711111111");
    expect(res.status).toBe(404);
    expect(body.error).toBe("No order found with this number and phone combination");
  });

  it("422s missing fields", async () => {
    const { res, body } = await track("", "123");
    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
  });
});

describe("rate limiting on /v1/orders/track", () => {
  it("allows 20 attempts per 10-minute window, then 429s", async () => {
    // Monolith-parity limiter (Phase-8 port): buckets are per-CLIENT-IP.
    // A single-entry x-forwarded-for is honoured (proxy-injected), so the
    // test simulates one real client. Unresolvable IPs share a scaled
    // "unknown" bucket (monolith round-3 audit semantics) — far above 20,
    // which is why the explicit IP header matters here.
    const headers = { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" };
    let saw429 = false;
    let okCount = 0;
    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch("http://localhost/v1/orders/track", {
        method: "POST",
        headers,
        body: JSON.stringify({ orderNumber: "SN100001", phone: "01711111111" }),
      });
      if (res.status === 429) {
        saw429 = true;
        const body = (await res.json()) as any;
        expect(body.code).toBe("RATE_LIMITED");
        break;
      } else {
        okCount++;
      }
    }
    // Fresh bucket for this IP: exactly 20 allowed, the 21st is rejected
    // (the rejected attempt is also counted — documented fixed-window policy).
    expect(okCount).toBe(20);
    expect(saw429).toBe(true);
  });
});
