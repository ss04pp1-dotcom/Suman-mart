// Supplier adapter interface — every dropshipping provider implements this.
// All adapter calls run server-side only; credentials never reach the browser.

export interface SupplierFeedProduct {
  externalId: string;
  name: string;
  description?: string;
  images: string[];
  price: number; // wholesale price in BDT
  stock: number;
  sku?: string;
  category?: string;
  variants?: { group: string; options: string[] }[];
  specs?: { group: string; key: string; value: string }[];
}

export interface SupplierOrderRequestItem {
  externalProductId: string;
  name: string;
  quantity: number;
  unitCost: number;
  options?: Record<string, string>;
}

export interface SupplierOrderRequest {
  externalCustomerId: string;
  customerName: string;
  customerPhone: string;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    area?: string | null;
    postalCode?: string | null;
  };
  items: SupplierOrderRequestItem[];
  note?: string;
}

export interface SupplierOrderResponse {
  ok: boolean;
  externalOrderId?: string;
  estimatedDeliveryDays?: number;
  message?: string;
}

export interface SupplierOrderStatus {
  status: "PENDING" | "PLACED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED";
  note?: string;
  itemsTotal?: number;
  shippingFee?: number;
}

export interface SupplierTracking {
  courier: string;
  trackingNumber: string;
  shippedAt?: string;
  estimatedDelivery?: string;
}

export interface SupplierAdapter {
  /** List supplier catalog (paginated). */
  getProducts(page?: number): Promise<{ products: SupplierFeedProduct[]; hasMore: boolean }>;
  /** Fetch one product by the supplier's own ID. */
  getProduct(externalId: string): Promise<SupplierFeedProduct | null>;
  /** Live stock lookup. */
  getStock(externalIds: string[]): Promise<Record<string, number>>;
  /** Place a dropship order with the supplier. */
  createOrder(order: SupplierOrderRequest): Promise<SupplierOrderResponse>;
  /** Poll fulfillment status of a supplier order. */
  getOrderStatus(externalOrderId: string): Promise<SupplierOrderStatus>;
  /** Courier + tracking number for a supplier order. */
  getTracking(externalOrderId: string): Promise<SupplierTracking | null>;
  /** Cancel where the supplier supports it. */
  cancelOrder(externalOrderId: string): Promise<{ ok: boolean; message: string }>;
}
