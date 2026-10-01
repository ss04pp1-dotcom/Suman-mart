import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import nodePath from "node:path";
import { ORDER_STATUS_FLOW, allowedTransitions, isValidTransition, isOrderStatus } from "@/lib/order-flow";

describe("order status lifecycle", () => {
  it("follows the happy path end to end", () => {
    const path = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows cancellation from pre-shipment stages", () => {
    for (const status of ["PENDING", "CONFIRMED", "PROCESSING"]) {
      expect(isValidTransition(status, "CANCELLED")).toBe(true);
    }
  });

  it("blocks cancellation after shipment (return flow instead)", () => {
    expect(isValidTransition("SHIPPED", "CANCELLED")).toBe(false);
    expect(isValidTransition("OUT_FOR_DELIVERY", "CANCELLED")).toBe(false);
    expect(isValidTransition("DELIVERED", "CANCELLED")).toBe(false);
  });

  it("allows RETURNED from post-shipment stages", () => {
    for (const status of ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]) {
      expect(isValidTransition(status, "RETURNED")).toBe(true);
    }
  });

  it("blocks backwards jumps and terminal resurrection", () => {
    expect(isValidTransition("DELIVERED", "PENDING")).toBe(false);
    expect(isValidTransition("SHIPPED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("CANCELLED", "PENDING")).toBe(false);
    expect(isValidTransition("RETURNED", "DELIVERED")).toBe(false);
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    expect(allowedTransitions("RETURNED")).toEqual([]);
  });

  it("treats same-status as a no-op, not a transition", () => {
    expect(isValidTransition("PENDING", "PENDING")).toBe(false);
  });

  it("recognizes every documented status", () => {
    for (const status of Object.keys(ORDER_STATUS_FLOW)) {
      expect(isOrderStatus(status)).toBe(true);
    }
    expect(isOrderStatus("WOKE_UP")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Round-4 audit: cancelling an order must RELEASE its still-unverified
// TrxID claim — otherwise the buyer's next order funded by the same real
// transfer is rejected with "ID already used" (unique index).
// DB-backed tests against the shared throwaway SQLite file.
// ────────────────────────────────────────────────────────────────────────

const TEST_DB = nodePath.resolve(__dirname, "../db/test-checkout.db");

beforeAll(async () => {
  // Idempotent schema sync (files execute sequentially — vitest.config.ts).
  execSync(`bunx prisma db push --skip-generate`, {
    cwd: nodePath.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
  // The throwaway DB persists between runs — clear OUR markers so a previous
  // run's rows never collide with this run's unique order numbers / TrxIDs
  // (payments cascade-delete with their order).
  const { db } = await import("@/lib/db");
  await db.order.deleteMany({ where: { orderNumber: { startsWith: "SNR4" } } });
});

describe("TrxID release on cancel/return (round 4)", () => {
  it("renames a PENDING payment's TrxID to <TRXID>-RELEASED-<orderNumber> and frees the original", async () => {
    const { db } = await import("@/lib/db");
    const { releasePendingTransactionIds } = await import("@/lib/order-flow");

    const order = await db.order.create({
      data: {
        orderNumber: `SNR4${Date.now()}`,
        status: "PENDING",
        paymentStatus: "UNPAID",
        paymentMethod: "BKASH",
        subtotal: 1000,
        shippingTotal: 0,
        codCharge: 0,
        total: 1000,
        customerName: "Test Buyer",
        customerPhone: "01712345678",
        shippingAddress: "{}",
      },
    });
    await db.payment.create({
      data: { orderId: order.id, method: "BKASH", status: "PENDING", amount: 1000, transactionId: "R4TRXTEST1" },
    });

    const released = await releasePendingTransactionIds(order.id);
    expect(released).toBe(1);

    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.transactionId).toBe(`R4TRXTEST1-RELEASED-${order.orderNumber}`);

    // The ORIGINAL ID is free again — a new payment can claim it (the
    // unique index on Payment.transactionId would throw otherwise).
    const order2 = await db.order.create({
      data: {
        orderNumber: `${order.orderNumber}B`,
        status: "PENDING",
        paymentStatus: "UNPAID",
        paymentMethod: "BKASH",
        subtotal: 1000,
        shippingTotal: 0,
        codCharge: 0,
        total: 1000,
        customerName: "Test Buyer",
        customerPhone: "01712345678",
        shippingAddress: "{}",
      },
    });
    await db.payment.create({
      data: { orderId: order2.id, method: "BKASH", status: "PENDING", amount: 1000, transactionId: "R4TRXTEST1" },
    });

    // Releasing a second time is a no-op (payment already renamed)
    expect(await releasePendingTransactionIds(order.id)).toBe(0);
  });

  it("does NOT release a VERIFIED (SUCCESS) TrxID — a refunded transfer must not prove a second payment", async () => {
    const { db } = await import("@/lib/db");
    const { releasePendingTransactionIds } = await import("@/lib/order-flow");

    const order = await db.order.create({
      data: {
        orderNumber: `SNR4S${Date.now()}`,
        status: "DELIVERED",
        paymentStatus: "PAID",
        paymentMethod: "BKASH",
        subtotal: 1000,
        shippingTotal: 0,
        codCharge: 0,
        total: 1000,
        customerName: "Test Buyer",
        customerPhone: "01712345678",
        shippingAddress: "{}",
      },
    });
    await db.payment.create({
      data: { orderId: order.id, method: "BKASH", status: "SUCCESS", amount: 1000, transactionId: "R4TRXLOCK1" },
    });

    expect(await releasePendingTransactionIds(order.id)).toBe(0);
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.transactionId).toBe("R4TRXLOCK1"); // untouched
  });
});
