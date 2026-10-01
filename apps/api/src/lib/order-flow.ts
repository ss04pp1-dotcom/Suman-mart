// Order lifecycle rules — ported from apps/storefront src/lib/order-flow.ts.
//
// Status transitions are validated against a flow map so an order can never
// jump backwards (e.g. DELIVERED → PENDING) or resurrect from a terminal
// state. Cancelling/returning an order restores reserved stock exactly once
// (guarded by Order.stockRestoredAt).
//
// Port note (restoreOrderStock): the monolith claimed the restock inside a
// Prisma interactive transaction and then incremented stock. On D1 the claim
// and every increment run as ONE atomic env.DB.batch:
//   1. the claim is a guarded UPDATE writing a JS-generated timestamp token;
//   2. every stock increment is conditional on the order's stockRestoredAt
//      EQUALING that token — if the claim lost the race (already restored),
//      stockRestoredAt holds an older value and all increments no-op;
//   3. a crash mid-batch rolls back the claim itself, so a retry works.

import { db } from "@/lib/db";
import { sqlDate } from "@/lib/config";

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURNED";

/** Allowed transitions — a status maps to the statuses that may follow it. */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["IN_TRANSIT", "RETURNED"],
  IN_TRANSIT: ["OUT_FOR_DELIVERY", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_FLOW;
}

/** Statuses an admin may move an order into from its current status. */
export function allowedTransitions(current: string): OrderStatus[] {
  return isOrderStatus(current) ? ORDER_STATUS_FLOW[current] : [];
}

export function isValidTransition(from: string, to: string): boolean {
  if (from === to) return false; // not a transition
  return allowedTransitions(from).includes(to as OrderStatus);
}

function d1(): D1Database {
  const env = (globalThis as unknown as { __apiEnv?: { DB: D1Database } }).__apiEnv;
  if (!env?.DB) throw new Error("order-flow used before the env bridge ran");
  return env.DB;
}

/**
 * Release the buyer-submitted TrxID of any still-UNVERIFIED payment when an
 * order dies (round-4 audit: a cancelled order used to keep its TrxID locked
 * forever — the buyer's next order with the same real transfer was rejected
 * with "ID already used").
 *
 * The ID is not deleted (audit trail) but renamed to
 * `<TRXID>-RELEASED-<orderNumber>` so the original becomes available again.
 * Only PENDING payments are released:
 *   • PENDING = the TrxID was never verified — it was just a claim holding
 *     a unique-index slot on a dead order. Free it.
 *   • SUCCESS = the transfer was verified real money; even after RETURNED /
 *     REFUNDED the historical reference stays locked (the buyer's NEW
 *     payment comes with a NEW TrxID — releasing the old one would allow
 *     one real SMS to prove two payments).
 *
 * Deterministic rename = no unique-index collisions (order numbers are
 * unique, and `<TRXID>-RELEASED-<orderNumber>` can only repeat if the very
 * same order is released twice, which the status flow map already forbids).
 */
export async function releasePendingTransactionIds(orderId: string): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });
  if (!order) return 0;

  const payments = await db.payment.findMany({
    where: { orderId, status: "PENDING", transactionId: { not: null } },
    select: { id: true, transactionId: true },
  });

  let released = 0;
  for (const p of payments) {
    // `not: null` still matches already-renamed rows — skip them so a repeat
    // call (double-cancel, retry) never stacks a second -RELEASED- suffix.
    if (!p.transactionId || p.transactionId.includes("-RELEASED-")) continue;
    const renamed = `${p.transactionId}-RELEASED-${order.orderNumber}`;
    const res = await db.payment
      .updateMany({
        where: { id: p.id, status: "PENDING", transactionId: p.transactionId },
        data: { transactionId: renamed },
      })
      .catch(() => ({ count: 0 }));
    released += res.count;
  }
  return released;
}

/**
 * Return reserved stock for an order (called when it becomes CANCELLED or
 * RETURNED). Idempotent — the stockRestoredAt guard makes double-cancels and
 * concurrent attempts safe. Claim + increments run in ONE atomic D1 batch.
 */
export async function restoreOrderStock(orderId: string): Promise<boolean> {
  const items = await db.orderItem.findMany({ where: { orderId } });
  const now = Date.now();
  const nowIso = sqlDate(now);
  // Crypto-random claim token — a timestamp alone could collide between two
  // same-millisecond concurrent restores and double-increment stock.
  const claimToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const statements: D1PreparedStatement[] = [
    // Claim the restock exactly once (guarded; writes our token)
    d1().prepare(
      `UPDATE "Order" SET "stockRestoredAt" = ?1, "stockRestoreToken" = ?2
       WHERE "id" = ?3 AND "stockRestoredAt" IS NULL AND "status" IN ('CANCELLED','RETURNED')`
    ).bind(nowIso, claimToken, orderId),
  ];

  for (const item of items) {
    if (!item.productId) continue;
    // Increments run ONLY when this batch's claim won (crypto-token equality).
    statements.push(
      d1().prepare(
        `UPDATE "Product" SET "stock" = "stock" + ?1, "soldCount" = "soldCount" - ?1, "updatedAt" = ?2
         WHERE "id" = ?3 AND EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?4 AND "stockRestoreToken" = ?5)`
      ).bind(item.quantity, nowIso, item.productId, orderId, claimToken)
    );
    if (item.variantId) {
      // A missing variant row is a no-op UPDATE (the monolith caught the
      // Prisma error instead — same outcome).
      statements.push(
        d1().prepare(
          `UPDATE "ProductVariant" SET "stock" = "stock" + ?1
           WHERE "id" = ?2 AND EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?3 AND "stockRestoreToken" = ?4)`
        ).bind(item.quantity, item.variantId, orderId, claimToken)
      );
    }
  }

  await d1().batch(statements);

  // Did OUR claim win? (The token on the row equals ours exactly when this
  // call performed the restore — cryptographically unforgeable.)
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { stockRestoreToken: true },
  });
  return !!order && order.stockRestoreToken === claimToken;
}
