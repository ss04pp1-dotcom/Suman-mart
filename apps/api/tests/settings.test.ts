import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

describe("GET /v1/settings/public", () => {
  it("merges stored settings over defaults and never leaks secrets", async () => {
    const res = await SELF.fetch("http://localhost/v1/settings/public");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, any> };
    expect(body.success).toBe(true);
    const d = body.data;

    // stored overrides
    expect(d.storeName).toBe("Suman Mart");
    expect(d.supportPhone).toBe("+880 1700-111111");
    // defaults for unset fields
    expect(d.tagline).toBe("Everything you love, delivered to your nest");
    expect(d.supportEmail).toBe("support@shopnest.com.bd");

    // payment from stored row; card ALWAYS false
    expect(d.paymentMethods).toEqual({
      cod: true,
      bkash: true,
      bkashNumber: "01700-000001",
      nagad: false,
      nagadNumber: "",
      card: false,
    });

    // shipping defaults (no stored row)
    expect(d.shipping).toEqual({
      flatRate: 60,
      freeShippingThreshold: 2000,
      estimatedDaysMin: 2,
      estimatedDaysMax: 5,
      codCharge: 0,
    });

    // pixels: META enabled → id exposed; GOOGLE disabled → null; TIKTOK enabled but unconfigured → null
    expect(d.pixels).toEqual({ metaPixelId: "1234567890", ga4MeasurementId: null, gtmId: null, tiktokPixelId: null });

    // secrets NEVER leave the server
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain("capiToken");
  });
});
