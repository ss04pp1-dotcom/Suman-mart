// Write-path integration tests — customer auth, cart validation, checkout
// (stock/coupon/TrxID guards, concurrency), order lifecycle. Runs against the
// REAL local D1 + R2 (workerd) with the real migrations + seed.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { initDb, CookieJar } from "./helpers";

beforeAll(initDb);

const JSON_HEADERS = { "Content-Type": "application/json" };
let ipCounter = 0;
/** Unique per-test client IP so rate-limit buckets never collide across tests. */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

function api(method: string, path: string, body: unknown, jar?: CookieJar, ip?: string) {
  return SELF.fetch(`http://localhost${path}`, {
    method,
    headers: {
      ...JSON_HEADERS,
      ...(ip ? { "x-forwarded-for": ip } : {}),
      ...(jar && jar.header() ? { cookie: jar.header() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

// ── Customer auth ───────────────────────────────────────────────────

describe("customer auth", () => {
  it("registers, issues a session cookie, and exposes /auth/me", async () => {
    const jar = new CookieJar();
    const res = await api("POST", "/v1/auth/register", {
      name: "Test Buyer",
      email: "buyer@example.com",
      phone: "01712345678",
      password: "BuyerPass123!",
    }, jar, freshIp());
    jar.capture(res);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(jar.get("sn_session")).toBeTruthy();

    const me = await json(await api("GET", "/v1/auth/me", undefined, jar));
    expect(me.data.customer.name).toBe("Test Buyer");
    expect(me.data.customer.email).toBe("buyer@example.com");
  });

  it("rejects duplicate registration emails", async () => {
    // NOTE: pool-workers isolates storage PER TEST — each test creates its own
    // fixtures (a previous test's writes are rolled back).
    const first = await api("POST", "/v1/auth/register", {
      name: "Dup Test", email: "dup@example.com", phone: "01712345678", password: "BuyerPass123!",
    }, undefined, freshIp());
    expect(first.status).toBe(200);
    const res = await api("POST", "/v1/auth/register", {
      name: "Dup",
      email: "dup@example.com",
      phone: "01712345678",
      password: "BuyerPass123!",
    }, undefined, freshIp());
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await api("POST", "/v1/auth/register", {
      name: "Login Test", email: "login@example.com", phone: "01712345678", password: "BuyerPass123!",
    }, undefined, freshIp());
    const ok = await api("POST", "/v1/auth/login", { email: "login@example.com", password: "BuyerPass123!" }, undefined, freshIp());
    expect(ok.status).toBe(200);

    const bad = await api("POST", "/v1/auth/login", { email: "login@example.com", password: "WrongPass!" }, undefined, freshIp());
    expect(bad.status).toBe(401);
  });

  it("password change revokes old sessions (tokenVersion bump)", async () => {
    await api("POST", "/v1/auth/register", {
      name: "Revoke Test", email: "revoke@example.com", phone: "01712345678", password: "BuyerPass123!",
    }, undefined, freshIp());
    const jar = new CookieJar();
    jar.capture(await api("POST", "/v1/auth/login", { email: "revoke@example.com", password: "BuyerPass123!" }, jar, freshIp()));
    const before = await json(await api("GET", "/v1/auth/me", undefined, jar));
    expect(before.data.customer).not.toBeNull();

    const change = await api("PUT", "/v1/account/profile", {
      currentPassword: "BuyerPass123!",
      newPassword: "NewBuyerPass456!",
    }, jar, freshIp());
    expect(change.status).toBe(200);

    // The cookie from BEFORE the change must no longer authenticate.
    const after = await json(await api("GET", "/v1/auth/me", undefined, jar));
    expect(after.data.customer).toBeNull();

    // New password signs in fine.
    const relogin = await api("POST", "/v1/auth/login", { email: "revoke@example.com", password: "NewBuyerPass456!" }, undefined, freshIp());
    expect(relogin.status).toBe(200);
  });

  it("logout clears the session", async () => {
    await api("POST", "/v1/auth/register", {
      name: "Logout Test", email: "logout@example.com", phone: "01712345678", password: "BuyerPass123!",
    }, undefined, freshIp());
    const jar = new CookieJar();
    jar.capture(await api("POST", "/v1/auth/login", { email: "logout@example.com", password: "BuyerPass123!" }, jar, freshIp()));
    const out = await api("POST", "/v1/auth/logout", {}, jar, freshIp());
    jar.capture(out); // the clearing Set-Cookie must overwrite the jar copy
    expect(out.status).toBe(200);
    const me = await json(await api("GET", "/v1/auth/me", undefined, jar));
    expect(me.data.customer).toBeNull();
  });
});

// ── Cart validation ─────────────────────────────────────────────────

describe("cart validation", () => {
  it("prices, stock and totals come from the server", async () => {
    const res = await api("POST", "/v1/cart/validate", {
      items: [{ productId: "p1", quantity: 2 }, { productId: "p1", variantId: "v1", quantity: 3 }],
    }, undefined, freshIp());
    const body = await json(res);
    expect(res.status).toBe(200);
    // p1 base 2500 ×2 + variant v1 2600 ×3
    expect(body.data.totals.subtotal).toBe(2 * 2500 + 3 * 2600);
    // flat-rate shipping 60 (below the 2000 free-shipping threshold? no:
    // 12800 >= 2000 → free). Settings default freeShippingThreshold=2000.
    expect(body.data.totals.freeShipping).toBe(true);
    expect(body.data.totals.shippingTotal).toBe(0);
  });

  it("flags oversold carts with per-line errors", async () => {
    const res = await api("POST", "/v1/cart/validate", {
      items: [{ productId: "p4", quantity: 6 }], // p4 stock = 5
    }, undefined, freshIp());
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.errors[0]).toContain("Only 5 left in stock");
    expect(body.data.lines).toHaveLength(0);
  });
});

// ── Checkout ────────────────────────────────────────────────────────

describe("checkout (guest, COD)", () => {
  it("places an order: order number, stock decrement, payment row, history", async () => {
    const res = await api("POST", "/v1/checkout", {
      items: [{ productId: "p3", quantity: 2 }],
      address: { fullName: "Guest Buyer", phone: "01799999999", line1: "Road 5", city: "Dhaka" },
      paymentMethod: "COD",
    }, undefined, freshIp());
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.orderNumber).toMatch(/^SN\d+$/);
    expect(body.data.paymentStatus).toBe("COD_PENDING");

    // Stock: 50 → 48, soldCount: 300 → 302 (direct D1 check)
    const { env } = await import("cloudflare:test");
    const row = await env.DB.prepare(`SELECT "stock","soldCount" FROM Product WHERE "id"='p3'`).first<{ stock: number; soldCount: number }>();
    expect(row?.stock).toBe(48);
    expect(row?.soldCount).toBe(302);

    // Order + history + payment persisted
    const order = await env.DB.prepare(`SELECT "id","status","paymentStatus" FROM "Order" WHERE "orderNumber"=?1`).bind(body.data.orderNumber).first<any>();
    expect(order?.status).toBe("PENDING");
    const history = await env.DB.prepare(`SELECT COUNT(*) AS n FROM OrderStatusHistory WHERE "orderId"=?1`).bind(order.id).first<any>();
    expect(history?.n).toBe(1);
    const payment = await env.DB.prepare(`SELECT "method","status","amount" FROM Payment WHERE "orderId"=?1`).bind(order.id).first<any>();
    expect(payment?.method).toBe("COD");
    expect(payment?.status).toBe("PENDING");

    // Server Purchase tracking event recorded with the purchaseEventId
    const event = await env.DB.prepare(`SELECT "name","value","source" FROM TrackingEvent WHERE "eventId"=?1`).bind(`purchase_${body.data.orderNumber}`).first<any>();
    expect(event?.name).toBe("Purchase");
    expect(event?.source).toBe("SERVER");
    expect(event?.value).toBe(body.data.total);
  });

  it("rejects oversell with NO side effects (guarded atomic batch)", async () => {
    const { env } = await import("cloudflare:test");
    const res = await api("POST", "/v1/checkout", {
      items: [{ productId: "p4", quantity: 5 }, { productId: "p4", quantity: 1 }], // stock 5 total → 6 requested
      address: { fullName: "Greedy", phone: "01700000001", line1: "XXXXXX", city: "Dhaka" },
      paymentMethod: "COD",
    }, undefined, freshIp());
    expect(res.status).toBe(409);
    const row = await env.DB.prepare(`SELECT "stock" FROM Product WHERE "id"='p4'`).first<any>();
    expect(row?.stock).toBe(5); // untouched
  });

  it("applies a coupon and enforces the per-customer limit", async () => {
    const place = (phone: string) =>
      api("POST", "/v1/checkout", {
        items: [{ productId: "p6", quantity: 2 }], // 700×2 = 1400
        couponCode: "WELCOME10",
        address: { fullName: "Coupon User", phone, line1: "YYYYYY", city: "Dhaka" },
        paymentMethod: "COD",
      }, undefined, freshIp());

    const first = await json(await place("01755500001"));
    expect(first.success).toBe(true);
    // 10% of 1400 = 140 (max 300 not hit) → total = 1400 - 140 + 60 shipping = 1320
    expect(first.data.total).toBe(1320);

    // Same phone → per-customer limit (1) rejects
    const second = await json(await place("01755500001"));
    expect(second.success).toBe(false);
    expect(second.error).toContain("already used this coupon");

    // Coupon usage counter advanced exactly once
    const { env } = await import("cloudflare:test");
    const coupon = await env.DB.prepare(`SELECT "usageCount" FROM Coupon WHERE "code"='WELCOME10'`).first<any>();
    expect(coupon?.usageCount).toBe(1);
  });

  it("rejects duplicate manual payment TrxIDs across orders", async () => {
    const payload = (trx: string) =>
      api("POST", "/v1/checkout", {
        items: [{ productId: "p6", quantity: 1 }],
        address: { fullName: "Bkash User", phone: "01755500002", line1: "ZZZZZZ", city: "Dhaka" },
        paymentMethod: "BKASH",
        paymentTrxId: trx,
      }, undefined, freshIp());

    const first = await payload("TRXTEST123");
    expect((await json(first)).success).toBe(true);

    const second = await payload("TRXTEST123");
    const body = await json(second);
    expect(second.status).toBe(409);
    expect(body.code).toBe("TRXID_ALREADY_USED");

    // A DIFFERENT TrxID still works (bKash enabled in seed settings)
    const third = await payload("TRXTEST124");
    expect((await json(third)).success).toBe(true);
  });

  it("blocks CARD payments (no gateway integrated)", async () => {
    const res = await api("POST", "/v1/checkout", {
      items: [{ productId: "p6", quantity: 1 }],
      address: { fullName: "Card User", phone: "01755500003", line1: "WWWWWW", city: "Dhaka" },
      paymentMethod: "CARD",
    }, undefined, freshIp());
    expect(res.status).toBe(400);
  });
});

// ── Concurrency: no oversell under parallel checkouts ───────────────

describe("checkout concurrency", () => {
  it("exactly the available stock is sold when parallel buyers race", async () => {
    const { env } = await import("cloudflare:test");
    // Fresh product with stock 5 via the admin-less direct route: use p8 (stock 15) — set stock to 5 first.
    await env.DB.prepare(`UPDATE Product SET "stock"=5 WHERE "id"='p8'`).run();

    const attempts = Array.from({ length: 8 }, (_, i) =>
      api("POST", "/v1/checkout", {
        items: [{ productId: "p8", quantity: 1 }],
        address: { fullName: `Racer ${i}`, phone: `0176660${String(i).padStart(4, "0")}`, line1: "RRRRRR", city: "Dhaka" },
        paymentMethod: "COD",
      }, undefined, `203.0.113.${100 + i}`)
    );
    const results = await Promise.all(attempts);
    const bodies = await Promise.all(results.map((r) => r.json() as Promise<any>));

    const successes = bodies.filter((b) => b.success).length;
    expect(successes).toBe(5);

    const row = await env.DB.prepare(`SELECT "stock" FROM Product WHERE "id"='p8'`).first<any>();
    expect(row?.stock).toBe(0);

    // Failed buyers see a friendly stock error, and their orders don't exist.
    const failures = bodies.filter((b) => !b.success);
    expect(failures.length).toBe(3);
    for (const f of failures) expect(f.error).toBeTruthy();
  });
});

// ── Order lifecycle via admin (cancel → stock restore, exactly once) ──

describe("order lifecycle + stock restore", () => {
  it("cancelling an order restores stock exactly once; re-cancel is a no-op", async () => {
    const { env } = await import("cloudflare:test");
    // Place an order on p5 (stock 25)
    const placed = await json(
      await api("POST", "/v1/checkout", {
        items: [{ productId: "p5", quantity: 4 }],
        address: { fullName: "Cancel Me", phone: "01777700001", line1: "CCCCCC", city: "Dhaka" },
        paymentMethod: "COD",
      }, undefined, freshIp())
    );
    expect(placed.success).toBe(true);

    let row = await env.DB.prepare(`SELECT "stock" FROM Product WHERE "id"='p5'`).first<any>();
    expect(row?.stock).toBe(21);

    // Admin login
    const admin = new CookieJar();
    const login = await api("POST", "/v1/admin/auth/login", { email: "admin@test.local", password: "Admin123!SuperSecure" }, admin, freshIp());
    admin.capture(login);
    expect(login.status).toBe(200);

    // Valid transition PENDING → CANCELLED
    const cancel = await api("PUT", `/v1/admin/orders/${placed.data.orderNumber}`, { status: "CANCELLED" }, admin, freshIp());
    expect(cancel.status).toBe(200);

    row = await env.DB.prepare(`SELECT "stock" FROM Product WHERE "id"='p5'`).first<any>();
    expect(row?.stock).toBe(25); // restored

    // Re-sending the SAME status is a no-op (the route only validates
    // transitions when the status actually changes — monolith parity), but
    // the exactly-once restock guard must still hold.
    const reCancel = await api("PUT", `/v1/admin/orders/${placed.data.orderNumber}`, { status: "CANCELLED" }, admin, freshIp());
    expect(reCancel.status).toBe(200);

    row = await env.DB.prepare(`SELECT "stock" FROM Product WHERE "id"='p5'`).first<any>();
    expect(row?.stock).toBe(25); // still 25 — exactly-once restore

    // And only ONE status-history entry was added by the cancellation.
    const history = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM OrderStatusHistory h JOIN "Order" o ON o.id = h."orderId" WHERE o."orderNumber" = ?1 AND h."status" = 'CANCELLED'`
    ).bind(placed.data.orderNumber).first<any>();
    expect(history?.n).toBe(1);
  });

  it("rejects backwards status transitions", async () => {
    const admin = new CookieJar();
    admin.capture(await api("POST", "/v1/admin/auth/login", { email: "admin@test.local", password: "Admin123!SuperSecure" }, admin, freshIp()));
    // o1 (seed) is SHIPPED — moving to PENDING must fail
    const res = await api("PUT", "/v1/admin/orders/o1", { status: "PENDING" }, admin, freshIp());
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.allowedStatuses).toEqual(["IN_TRANSIT", "RETURNED"]);
  });
});
