import type { Supplier } from "@/generated/prisma/client";
import type { SupplierAdapter } from "./types";
import { DemoWholesaleAdapter } from "./demo-adapter";

// ── Adapter registry ──────────────────────────────────────────────
// Add real HTTP adapters here as the business signs up suppliers:
//   "rest-api-v1" → RestApiAdapter (generic REST mapping)
// Every adapter receives the supplier record so it can use server-side
// credentials (apiKey / apiSecret / baseUrl) when talking to the supplier.

const ADAPTERS: Record<string, (supplier: Supplier) => SupplierAdapter> = {
  "demo-wholesale-v1": (supplier) => new DemoWholesaleAdapter(supplier.code),
};

export function getAdapter(supplier: Supplier): SupplierAdapter {
  const factory = ADAPTERS[supplier.adapter];
  if (!factory) {
    throw new Error(`Unknown supplier adapter "${supplier.adapter}"`);
  }
  return factory(supplier);
}

export const AVAILABLE_ADAPTERS = [
  {
    key: "demo-wholesale-v1",
    label: "Demo Wholesale API (sandbox)",
    description: "Fully functional simulated supplier for development and demos. Implements the complete adapter interface.",
  },
];
