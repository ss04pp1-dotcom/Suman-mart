import type {
  SupplierAdapter,
  SupplierFeedProduct,
  SupplierOrderRequest,
  SupplierOrderResponse,
  SupplierOrderStatus,
  SupplierTracking,
} from "./types";
import { DEMO_CATALOG } from "./demo-catalog";

/**
 * Demo wholesale supplier adapter.
 *
 * This is a fully functional in-process implementation of the supplier
 * interface backed by a static feed (see demo-catalog.ts). It exists so the
 * complete dropshipping pipeline — sync, price/stock updates, supplier order
 * placement, status polling, tracking, cancellation — can run end-to-end
 * without real supplier credentials.
 *
 * In production you would register additional adapters (e.g. `rest-api-v1`)
 * that speak HTTP to a real supplier API using server-side credentials.
 * The rest of ShopNest only depends on the SupplierAdapter interface.
 */

// Deterministic pseudo-random so "API responses" feel alive but stay reproducible
function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// Supplier order ledger (persists for the process lifetime)
interface LedgerEntry {
  request: SupplierOrderRequest;
  status: SupplierOrderStatus["status"];
  createdAt: Date;
  courier?: string;
  trackingNumber?: string;
  cancelledWithinWindow: boolean;
}

const orderLedger = new Map<string, LedgerEntry>();

export class DemoWholesaleAdapter implements SupplierAdapter {
  constructor(private supplierCode: string) {}

  async getProducts(page = 1): Promise<{ products: SupplierFeedProduct[]; hasMore: boolean }> {
    const perPage = 20;
    const start = (page - 1) * perPage;
    const products = DEMO_CATALOG.slice(start, start + perPage).map((p) => ({
      ...p,
      // Stock jitters slightly per sync to mimic a live feed
      stock: Math.max(0, p.stock - Math.floor(seededRandom(`${p.externalId}:${new Date().toISOString().slice(0, 10)}`) * 5)),
      price: p.price,
    }));
    return { products, hasMore: start + perPage < DEMO_CATALOG.length };
  }

  async getProduct(externalId: string): Promise<SupplierFeedProduct | null> {
    const p = DEMO_CATALOG.find((c) => c.externalId === externalId);
    return p ? { ...p } : null;
  }

  async getStock(externalIds: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const id of externalIds) {
      const p = DEMO_CATALOG.find((c) => c.externalId === id);
      result[id] = p ? Math.max(0, p.stock - Math.floor(seededRandom(`${id}:stock`) * 4)) : 0;
    }
    return result;
  }

  async createOrder(order: SupplierOrderRequest): Promise<SupplierOrderResponse> {
    // Simulate rare supplier rejection (out of stock at supplier)
    for (const item of order.items) {
      const stockMap = await this.getStock([item.externalProductId]);
      if ((stockMap[item.externalProductId] ?? 0) < item.quantity) {
        return { ok: false, message: `Item ${item.name} is out of stock at the supplier` };
      }
    }
    const externalOrderId = `${this.supplierCode.toUpperCase()}-SO-${Date.now().toString().slice(-8)}`;
    orderLedger.set(externalOrderId, {
      request: order,
      status: "PLACED",
      createdAt: new Date(),
      cancelledWithinWindow: false,
    });
    return { ok: true, externalOrderId, estimatedDeliveryDays: 3 + Math.floor(seededRandom(externalOrderId) * 3) };
  }

  async getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatus> {
    const entry = orderLedger.get(externalOrderId);
    if (!entry) return { status: "FAILED", note: "Supplier order not found" };

    // Orders progress over time: PLACED → PROCESSING → SHIPPED → DELIVERED
    const ageHours = (Date.now() - entry.createdAt.getTime()) / 3_600_000;
    if (entry.status !== "CANCELLED") {
      if (ageHours > 72) entry.status = "DELIVERED";
      else if (ageHours > 24) entry.status = "SHIPPED";
      else if (ageHours > 2) entry.status = "PROCESSING";
    }

    const itemsTotal = entry.request.items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0);
    return {
      status: entry.status,
      itemsTotal,
      shippingFee: 40,
      note: entry.status === "CANCELLED" ? "Order cancelled before fulfillment" : undefined,
    };
  }

  async getTracking(externalOrderId: string): Promise<SupplierTracking | null> {
    const entry = orderLedger.get(externalOrderId);
    if (!entry || (entry.status !== "SHIPPED" && entry.status !== "DELIVERED")) return null;
    entry.courier ??= "Steadfast Courier";
    entry.trackingNumber ??= `SF${Math.floor(seededRandom(externalOrderId) * 900000000 + 100000000)}`;
    return {
      courier: entry.courier,
      trackingNumber: entry.trackingNumber,
      shippedAt: new Date(entry.createdAt.getTime() + 24 * 3_600_000).toISOString(),
      estimatedDelivery: new Date(entry.createdAt.getTime() + 96 * 3_600_000).toISOString(),
    };
  }

  async cancelOrder(externalOrderId: string): Promise<{ ok: boolean; message: string }> {
    const entry = orderLedger.get(externalOrderId);
    if (!entry) return { ok: false, message: "Supplier order not found" };
    if (entry.status === "SHIPPED" || entry.status === "DELIVERED") {
      return { ok: false, message: "Order already shipped — cancellation not possible" };
    }
    entry.status = "CANCELLED";
    return { ok: true, message: "Supplier order cancelled successfully" };
  }
}
