import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Integration tests for the checkout engine — stock integrity, coupon
// limits, guest identity, and post-commit resilience against a real SQLite
// database. This is the highest-risk code path in the platform.
//
// A temp database is created per run; every test starts from the schema
// (prisma migrate deploy equivalent via db push) plus minimal seed rows.
// ─────────────────────────────────────────────────────────────────────────

const TEST_DB = path.resolve(__dirname, "../db/test-checkout.db");

// `after` from next/server would throw outside a request scope in vitest —
// run the callback inline instead (other exports stay real).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: async (fn: () => Promise<unknown>) => {
    await fn().catch(() => undefined);
  },
}));

// recordServerEvent is mockable so we can simulate post-commit failures
// (the rest of the tracking module stays real for any other importer).
vi.mock("@/lib/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking")>()),
  recordServerEvent: vi.fn(async () => ({ recorded: true, duplicate: false })),
}));

beforeAll(() => {
  fs.rmSync(TEST_DB, { force: true });
  fs.rmSync(`${TEST_DB}-journal`, { force: true });
  execSync(`bunx prisma db push --skip-generate --force-reset`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
});

afterAll(() => {
  fs.rmSync(TEST_DB, { force: true });
  fs.rmSync(`${TEST_DB}-journal`, { force: true });
});

import { db } from "@/lib/db";
import { validateCart, validateCoupon, createOrder, CheckoutError, type ValidatedLine } from "@/lib/checkout";
import { recordServerEvent } from "@/lib/tracking";

const ADDRESS = {
  fullName: "Nusrat Jahan",
  phone: "01712345678",
  line1: "House 12, Road 5",
  city: "Dhaka",
  area: "Dhanmondi",
  postalCode: "1205",
};

async function seedProduct(opts: { stock: number; price?: number; name?: string }) {
  const category = await db.category.create({ data: { name: opts.name ?? `Cat ${Math.random()}`, slug: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } });
  return db.product.create({
    data: {
      name: opts.name ?? "Test Product",
      slug: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      price: opts.price ?? 500,
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stock: opts.stock,
      categoryId: category.id,
    },
  });
}

function line(product: { id: string }, quantity = 1, unitPrice = 500): ValidatedLine {
  return {
    productId: product.id,
    variantId: null,
    name: "Test Product",
    sku: "SKU-X",
    imageUrl: null,
    unitPrice,
    quantity,
    total: unitPrice * quantity,
    options: null,
    stock: 99,
    supplierId: null,
  };
}

describe("validateCart", () => {
  it("reports the correct remaining stock when one product spans multiple lines", async () => {
    const product = await seedProduct({ stock: 3 });
    const { lines, errors } = await validateCart([
      { productId: product.id, quantity: 2 },
      { productId: product.id, quantity: 2 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Only 1 left in stock/);
    expect(lines).toHaveLength(1);
  });

  it("rejects inactive/unknown products instead of silently dropping them", async () => {
    const product = await seedProduct({ stock: 5 });
    await db.product.update({ where: { id: product.id }, data: { isActive: false } });
    const { lines, errors } = await validateCart([{ productId: product.id, quantity: 1 }]);
    expect(lines).toHaveLength(0);
    expect(errors[0]).toMatch(/no longer available/);
  });
});

async function waitForOutbox(email: string, subjectContains: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const row = await db.mailOutbox.findFirst({ where: { toEmail: email }, orderBy: { createdAt: "desc" } });
    if (row?.subject.includes(subjectContains)) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe("createOrder — stock integrity", () => {
  it("decrements product and variant stock atomically", async () => {
    const product = await seedProduct({ stock: 10 });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        name: "Black / M",
        options: "{}",
        stock: 4,
        sku: "VAR-1",
      },
    });
    const vl: ValidatedLine = { ...line(product, 2), variantId: variant.id, stock: 4 };

    const order = await createOrder({
      lines: [vl],
      couponResult: null,
      address: ADDRESS,
      paymentMethod: "COD",
      customerId: null,
      customerEmail: "guest-stock@example.com",
    });

    expect(order.orderNumber).toMatch(/^SN\d+$/);
    expect(order.paymentStatus).toBe("COD_PENDING");
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    const afterVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stock).toBe(8);
    expect(afterVariant.stock).toBe(2);

    // Guest confirmation email lands in the outbox (sendMail is fire-and-forget,
    // so poll briefly for the row)
    const outbox = await waitForOutbox("guest-stock@example.com", order.orderNumber);
    expect(outbox?.subject).toContain(order.orderNumber);
    expect(outbox?.body).toContain("cash on delivery");
  });

  it("blocks the whole order when stock is insufficient (no partial orders)", async () => {
    const product = await seedProduct({ stock: 1 });
    await expect(
      createOrder({
        lines: [line(product, 2)],
        couponResult: null,
        address: ADDRESS,
        paymentMethod: "COD",
        customerId: null,
        customerEmail: "insufficient@example.com",
      })
    ).rejects.toThrow(CheckoutError);

    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(1); // untouched
    const count = await db.order.count({ where: { customerEmail: "insufficient@example.com" } });
    expect(count).toBe(0);
  });

  it("exactly one winner when concurrent checkouts race for the last unit", async () => {
    const product = await seedProduct({ stock: 1 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        createOrder({
          lines: [line(product, 1)],
          couponResult: null,
          address: ADDRESS,
          paymentMethod: "COD",
          customerId: null,
          customerEmail: "racer@example.com",
        })
      )
    );
    const winners = attempts.filter((a) => a.status === "fulfilled");
    const losers = attempts.filter((a) => a.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(0);
    // No oversell, no duplicate order numbers
    const orders = await db.order.findMany({ where: { customerEmail: "racer@example.com" } });
    expect(orders).toHaveLength(1);
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(orders.length);
  });

  it("never oversells under a 16-way race for 5 units (round-3 audit)", async () => {
    const product = await seedProduct({ stock: 5 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) =>
        createOrder({
          lines: [line(product, 1)],
          couponResult: null,
          address: ADDRESS,
          paymentMethod: "COD",
          customerId: null,
          customerEmail: `race16-${i}@example.com`,
        })
      )
    );
    const winners = attempts.filter((a) => a.status === "fulfilled");
    const losers = attempts.filter((a) => a.status === "rejected");
    // Exactly the available stock may succeed — not one more, not one less
    expect(winners).toHaveLength(5);
    expect(losers).toHaveLength(11);
    for (const l of losers) {
      expect(l.reason).toBeInstanceOf(CheckoutError);
    }
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(0);
    // Stock can never go negative and numbers stay unique
    expect(after.stock).toBeGreaterThanOrEqual(0);
    const numbers = winners.map((w) => (w as PromiseFulfilledResult<{ orderNumber: string }>).value.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    // …and every winner decremented soldCount consistently
    expect(after.soldCount).toBe(5);
  });

  it("never oversells VARIANT stock when 10 orders race for 3 units", async () => {
    const product = await seedProduct({ stock: 50 });
    const variant = await db.productVariant.create({
      data: { productId: product.id, name: "Blue / L", options: "{}", stock: 3, sku: `VR-${Date.now()}` },
    });
    const vl = (qty = 1): ValidatedLine => ({ ...line(product, qty), variantId: variant.id, stock: 3 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createOrder({
          lines: [vl()],
          couponResult: null,
          address: ADDRESS,
          paymentMethod: "COD",
          customerId: null,
          customerEmail: `vrace-${i}@example.com`,
        })
      )
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    const afterVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterVariant.stock).toBe(0);
    expect(afterVariant.stock).toBeGreaterThanOrEqual(0);
  });
});

describe("createOrder — coupon limits", () => {
  it("enforces the global usage limit atomically under concurrency", async () => {
    const product = await seedProduct({ stock: 50 });
    const coupon = await db.coupon.create({
      data: {
        code: `RACE${Date.now().toString(36).toUpperCase()}`,
        type: "FIXED",
        value: 100,
        usageLimit: 1,
        perCustomerLimit: null,
      },
    });
    const makeOrder = () =>
      createOrder({
        lines: [line(product, 1)],
        couponResult: { ok: true, reason: undefined, discount: 100, freeShipping: false, coupon },
        address: ADDRESS,
        paymentMethod: "COD",
        customerId: null,
        customerEmail: `race${Math.random()}@example.com`,
      });
    const results = await Promise.allSettled([makeOrder(), makeOrder(), makeOrder()]);
    const winners = results.filter((r) => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.usageCount).toBe(1);
  });

  it("enforces the per-customer limit for GUESTS via email identity", async () => {
    const product = await seedProduct({ stock: 50 });
    const coupon = await db.coupon.create({
      data: {
        code: `GUEST${Date.now().toString(36).toUpperCase()}`,
        type: "FIXED",
        value: 50,
        perCustomerLimit: 1,
      },
    });
    const input = {
      lines: [line(product, 1)],
      couponResult: { ok: true, reason: undefined, discount: 50, freeShipping: false, coupon } as const,
      address: ADDRESS,
      paymentMethod: "COD",
      customerId: null,
      customerEmail: "same-guest@example.com",
    };
    await createOrder(input); // first use OK
    await expect(createOrder(input)).rejects.toThrow(CheckoutError); // second use blocked
  });

  it("blocks a guest reusing a coupon with a different email but the same phone", async () => {
    const product = await seedProduct({ stock: 50 });
    const coupon = await db.coupon.create({
      data: { code: `PHONE${Date.now().toString(36).toUpperCase()}`, type: "FIXED", value: 50, perCustomerLimit: 1 },
    });
    const base = {
      lines: [line(product, 1)],
      couponResult: { ok: true, reason: undefined, discount: 50, freeShipping: false, coupon } as const,
      paymentMethod: "COD",
      customerId: null,
    };
    await createOrder({ ...base, address: ADDRESS, customerEmail: "a@example.com" });
    // Same phone, DIFFERENT email — still recognized as the same buyer
    await expect(
      createOrder({ ...base, address: { ...ADDRESS, phone: "01712345678" }, customerEmail: "b@example.com" })
    ).rejects.toThrow(CheckoutError);
  });
});

describe("validateCoupon", () => {
  it("validates minimum order amounts and expiry", async () => {
    const product = await seedProduct({ stock: 5, price: 500 });
    const lines = [line(product, 1, 500)];

    const minOrder = await db.coupon.create({
      data: { code: `MIN${Date.now().toString(36).toUpperCase()}`, type: "FIXED", value: 50, minOrderAmount: 1000 },
    });
    const r1 = await validateCoupon(minOrder.code, 500, lines, { customerId: null });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toMatch(/Minimum order/);

    const expired = await db.coupon.create({
      data: { code: `EXP${Date.now().toString(36).toUpperCase()}`, type: "FIXED", value: 50, startsAt: new Date(Date.now() - 7200_000), expiresAt: new Date(Date.now() - 3600_000) },
    });
    const r2 = await validateCoupon(expired.code, 500, lines, { customerId: null });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/expired/);
  });
});

describe("createOrder — manual payment TrxID integrity (round 3)", () => {
  it("stores the buyer's TrxID on the payment row (uppercase-normalized)", async () => {
    const product = await seedProduct({ stock: 5 });
    const order = await createOrder({
      lines: [line(product, 1)],
      couponResult: null,
      address: ADDRESS,
      paymentMethod: "BKASH",
      paymentTrxId: "9f7hd2k1lm",
      customerId: null,
      customerEmail: "trxid-first@example.com",
    });
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.transactionId).toBe("9F7HD2K1LM");
    expect(payment.status).toBe("PENDING");
    expect(payment.amount).toBe(order.total);
  });

  it("rejects the SAME bKash TrxID on a second order (unique index, race-safe)", async () => {
    const product = await seedProduct({ stock: 50 });
    const base = {
      lines: [line(product, 1)],
      couponResult: null,
      address: ADDRESS,
      paymentMethod: "BKASH" as const,
      paymentTrxId: "DUPLICATE1X",
      customerId: null,
    };
    const first = await createOrder({ ...base, customerEmail: "trx-a@example.com" });
    expect(first.orderNumber).toMatch(/^SN\d+$/);

    // Sequential duplicate → unique index violation → clean CheckoutError,
    // and the second order is fully rolled back (no order row, no stock move)
    const stockBefore = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
    await expect(createOrder({ ...base, customerEmail: "trx-b@example.com" })).rejects.toThrow(
      /transaction ID has already been used/
    );
    const stockAfter = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
    expect(stockAfter).toBe(stockBefore);
    const ordersWithTrx = await db.payment.count({ where: { transactionId: "DUPLICATE1X" } });
    expect(ordersWithTrx).toBe(1);

    // Concurrent duplicates → exactly one winner, the other blocked by the index
    const attempts = await Promise.allSettled([
      createOrder({ ...base, paymentTrxId: "RACE3TRX9Z", customerEmail: "trx-c@example.com" }),
      createOrder({ ...base, paymentTrxId: "RACE3TRX9Z", customerEmail: "trx-d@example.com" }),
      createOrder({ ...base, paymentTrxId: "RACE3TRX9Z", customerEmail: "trx-e@example.com" }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await db.payment.count({ where: { transactionId: "RACE3TRX9Z" } })).toBe(1);
  });
});

describe("createOrder — post-commit resilience", () => {
  it("still returns the order when post-commit side effects explode", async () => {
    const product = await seedProduct({ stock: 5 });
    const mocked = vi.mocked(recordServerEvent);
    mocked.mockRejectedValueOnce(new Error("analytics DB exploded"));

    const order = await createOrder({
      lines: [line(product, 1)],
      couponResult: null,
      address: ADDRESS,
      paymentMethod: "COD",
      customerId: null,
      customerEmail: "resilient@example.com",
    });

    // The customer got their order — no duplicate-order trap
    expect(order.orderNumber).toMatch(/^SN\d+$/);
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(4);
    expect(mocked).toHaveBeenCalled();
    mocked.mockReset();
    mocked.mockResolvedValue({ recorded: true, duplicate: false });
  });
});

describe("createOrder — guest email optional (round 5)", () => {
  it("creates a guest order with NO email and attempts no confirmation mail", async () => {
    const product = await seedProduct({ stock: 5 });
    const outboxBefore = await db.mailOutbox.count();

    const order = await createOrder({
      lines: [line(product, 2)],
      couponResult: null,
      address: ADDRESS,
      paymentMethod: "COD",
      customerId: null,
      customerEmail: null, // round-5: no email → no mail → nothing to abuse
    });

    expect(order.orderNumber).toMatch(/^SN\d+$/);
    expect(order.customerEmail).toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);

    // No confirmation mail was even attempted (createOrder guards the send
    // on a present email) — the outbox is unchanged.
    expect(await db.mailOutbox.count()).toBe(outboxBefore);
  });
});
