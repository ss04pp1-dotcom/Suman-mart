import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────
// Order lifecycle rules.
//
// Status transitions are validated against a flow map so an order can never
// jump backwards (e.g. DELIVERED → PENDING) or resurrect from a terminal
// state. Cancelling/returning an order restores reserved stock exactly once
// (guarded by Order.stockRestoredAt).
// ─────────────────────────────────────────────────────────────────────────

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
 * concurrent attempts safe.
 */
export async function restoreOrderStock(orderId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // Claim the restock exactly once
    const claimed = await tx.order.updateMany({
      where: { id: orderId, stockRestoredAt: null, status: { in: ["CANCELLED", "RETURNED"] } },
      data: { stockRestoredAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      if (!item.productId) continue;
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: { increment: item.quantity },
          soldCount: { decrement: item.quantity },
        },
      });
      if (item.variantId) {
        await tx.productVariant
          .update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          })
          .catch(() => undefined); // variant may have been deleted
      }
    }
    return true;
  });
}
