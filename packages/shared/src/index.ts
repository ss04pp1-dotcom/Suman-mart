// Shared API contracts for the Suman Mart / ShopNest platform.
//
// Edge-safe by construction: no Node APIs, no filesystem, no Prisma — these
// types, constants and zod schemas are imported by the Cloudflare Workers API
// (apps/api) and can be imported by the storefront / admin apps to keep their
// HTTP clients in lockstep with the server contract.
//
// The response envelope intentionally matches the long-standing monolith
// helpers (src/lib/api.ts ok()/fail()) so existing clients keep working
// through the migration to the separate API service.

import { z } from "zod";

// ── API identity ────────────────────────────────────────────────────

export const API_VERSION = "v1" as const;

// ── Response envelope ───────────────────────────────────────────────

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  /** Machine-readable code for programmatic handling (optional). */
  code?: string;
}

export type ApiBody<T> = ApiSuccessBody<T> | ApiErrorBody;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// ── Product listing contract ────────────────────────────────────────

export const PRODUCT_SORTS = [
  "featured",
  "newest",
  "price_asc",
  "price_desc",
  "best_selling",
  "rating",
  "discount",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const AVAILABILITY_FILTERS = ["in_stock", "out_of_stock"] as const;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  availability: z.enum(AVAILABILITY_FILTERS).optional(),
  featured: z.enum(["true", "false"]).optional(),
  sort: z.enum(PRODUCT_SORTS).default("featured"),
});
export type ProductListQuery = z.output<typeof productListQuerySchema>;

// ── Order tracking contract ─────────────────────────────────────────

export const trackOrderSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40),
  phone: z.string().trim().min(6).max(20),
});
export type TrackOrderInput = z.output<typeof trackOrderSchema>;

// ── Public settings contract ────────────────────────────────────────

export interface PublicSettings {
  storeName: string;
  tagline: string;
  supportPhone: string;
  supportEmail: string;
  /**
   * Guest checkout email verification is enforced by the CHECKOUT service
   * (the write-path lives there until it is ported to the Workers API).
   * The API mirrors the current policy flag for client display purposes.
   */
  guestEmailVerification: boolean;
  paymentMethods: {
    cod: boolean;
    bkash: boolean;
    bkashNumber: string;
    nagad: boolean;
    nagadNumber: string;
    card: boolean; // hard-disabled: no card gateway is integrated
  };
  shipping: {
    flatRate: number;
    freeShippingThreshold: number;
    estimatedDaysMin: number;
    estimatedDaysMax: number;
    codCharge: number;
  };
  pixels: {
    metaPixelId: string | null;
    ga4MeasurementId: string | null;
    gtmId: string | null;
    tiktokPixelId: string | null;
  };
}
