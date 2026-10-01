import { db } from "@/lib/db";
import type { Order, Supplier } from "@prisma/client";
import { getAdapter } from "./registry";
import { notify } from "@/lib/notifications";
import { parseJSON, stringifyJSON } from "@/lib/json";

// ─────────────────────────────────────────────────────────────────────────
// Supplier order lifecycle: create(PENDING) → process/retry → poll → track
//
// Checkout only INSERTS pending SupplierOrder rows inside its transaction.
// The actual supplier API calls happen in the background (next/server
// `after()`) so a slow or failing supplier never blocks the customer's
// order confirmation. Failed placements are retried with attempt counting.
// ─────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;

/** Process all PENDING supplier orders of a freshly created order. */
export async function processPendingSupplierOrders(orderId: string): Promise<{ placed: number; failed: number; skipped: number }> {
  const pending = await db.supplierOrder.findMany({
    where: { orderId, status: "PENDING" },
    include: { supplier: true },
  });

  let placed = 0;
  let failed = 0;
  let skipped = 0;

  for (const so of pending) {
    if (so.attempts >= MAX_ATTEMPTS) {
      skipped++;
      continue;
    }
    const result = await placeOne(so.id);
    if (result === "PLACED") placed++;
    else if (result === "FAILED") failed++;
    else skipped++;
  }

  return { placed, failed, skipped };
}

/** Retry FAILED supplier orders that haven't exhausted their attempts (admin maintenance). */
export async function retryFailedSupplierOrders(): Promise<{ retried: number }> {
  const candidates = await db.supplierOrder.findMany({
    where: { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
    select: { id: true },
    take: 25,
  });
  for (const c of candidates) await placeOne(c.id);
  return { retried: candidates.length };
}

async function placeOne(supplierOrderId: string): Promise<"PLACED" | "FAILED" | "SKIPPED"> {
  const so = await db.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { supplier: true, order: true },
  });
  if (!so || !so.supplier || !so.order) return "SKIPPED";
  if (so.status !== "PENDING" && so.status !== "FAILED") return "SKIPPED";
  if (so.attempts >= MAX_ATTEMPTS) return "SKIPPED";
  if (!so.supplier.isActive) {
    await db.supplierOrder.update({
      where: { id: so.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: "Supplier inactive" },
    });
    return "FAILED";
  }

  const items = await db.orderItem.findMany({
    where: { orderId: so.orderId, supplierId: so.supplierId },
    include: { product: { include: { supplierProduct: true } } },
  });

  const adapter = getAdapter(so.supplier);
  const address = parseJSON<{ line1: string; line2?: string | null; city: string; area?: string | null; postalCode?: string | null }>(
    so.order.shippingAddress,
    { line1: "", city: "" }
  );

  const unitCost = (i: (typeof items)[number]) =>
    i.product?.supplierProduct?.price ?? i.product?.costPrice ?? Math.round(i.unitPrice * 0.65);

  const itemsTotal = items.reduce((sum, i) => sum + unitCost(i) * i.quantity, 0);

  try {
    const response = await adapter.createOrder({
      externalCustomerId: `cust_${so.order.customerId ?? so.order.id}`,
      customerName: so.order.customerName,
      customerPhone: so.order.customerPhone,
      address,
      items: items.map((i) => ({
        externalProductId: i.product?.supplierProduct?.externalId ?? "UNKNOWN",
        name: i.name,
        quantity: i.quantity,
        unitCost: unitCost(i),
        options: parseJSON<Record<string, string>>(i.options, {}),
      })),
      note: `ShopNest order ${so.order.orderNumber}`,
    });

    await db.supplierOrder.update({
      where: { id: so.id },
      data: {
        externalOrderId: response.externalOrderId ?? null,
        status: response.ok ? "PLACED" : "FAILED",
        itemsTotal,
        shippingFee: 40,
        total: itemsTotal + 40,
        placedAt: response.ok ? new Date() : null,
        attempts: { increment: 1 },
        lastError: response.ok ? null : (response.message ?? "The supplier rejected the order."),
        statusPayload: stringifyJSON(response),
      },
    });

    if (!response.ok) {
      await notify(
        "SUPPLIER",
        `Supplier order failed for ${so.order.orderNumber}`,
        response.message ?? "The supplier rejected the order."
      );
      return "FAILED";
    }
    return "PLACED";
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown supplier error";
    await db.supplierOrder.update({
      where: { id: so.id },
      data: {
        status: "FAILED",
        itemsTotal,
        attempts: { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });
    await notify("SUPPLIER", `Supplier order failed for ${so.order.orderNumber}`, message.slice(0, 240));
    return "FAILED";
  }
}

/** Poll one supplier order's status + tracking and sync it into ShopNest. */
export async function refreshSupplierOrder(supplierOrderId: string) {
  const so = await db.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { supplier: true, order: true },
  });
  if (!so || !so.supplier) throw new Error("Supplier order not found");

  const adapter = getAdapter(so.supplier);
  let statusChanged = false;

  if (so.externalOrderId) {
    const status = await adapter.getOrderStatus(so.externalOrderId);
    if (status.status !== so.status) {
      statusChanged = true;
      await db.supplierOrder.update({
        where: { id: so.id },
        data: {
          status: status.status,
          statusPayload: stringifyJSON(status),
          lastCheckedAt: new Date(),
        },
      });
      await db.orderStatusHistory.create({
        data: {
          orderId: so.orderId,
          status: so.order.status,
          note: `Supplier order ${so.externalOrderId}: ${status.status}${status.note ? ` — ${status.note}` : ""}`,
          createdBy: "supplier",
        },
      });

      // When the supplier ships, mirror tracking onto the customer order
      if (status.status === "SHIPPED") {
        const tracking = await adapter.getTracking(so.externalOrderId);
        if (tracking) {
          await db.supplierOrder.update({
            where: { id: so.id },
            data: { trackingNumber: tracking.trackingNumber, courier: tracking.courier },
          });
          await db.order.update({
            where: { id: so.orderId },
            data: {
              courier: tracking.courier,
              trackingNumber: tracking.trackingNumber,
              status: "SHIPPED",
            },
          });
          await db.orderStatusHistory.create({
            data: {
              orderId: so.orderId,
              status: "SHIPPED",
              note: `${tracking.courier} — tracking ${tracking.trackingNumber}`,
              createdBy: "supplier",
            },
          });
        }
      }
    } else {
      await db.supplierOrder.update({
        where: { id: so.id },
        data: { lastCheckedAt: new Date() },
      });
    }
  }

  return { statusChanged };
}

/** Request cancellation from the supplier (where supported). */
export async function cancelSupplierOrder(supplierOrderId: string) {
  const so = await db.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { supplier: true },
  });
  if (!so || !so.supplier) throw new Error("Supplier order not found");
  if (!so.externalOrderId) {
    await db.supplierOrder.update({
      where: { id: so.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return { ok: true, message: "No external order existed — marked cancelled" };
  }

  const adapter = getAdapter(so.supplier);
  const result = await adapter.cancelOrder(so.externalOrderId);
  if (result.ok) {
    await db.supplierOrder.update({
      where: { id: so.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelRequestedAt: new Date(),
      },
    });
  }
  return result;
}

/** Type re-exports used by admin routes. */
export type { Supplier };
export type SupplierOrderContext = Order;
