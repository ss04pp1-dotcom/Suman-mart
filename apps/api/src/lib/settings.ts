import { db } from "@/lib/db";
import { parseJSON, stringifyJSON } from "@/lib/json";


// ── Typed setting shapes ───────────────────────────────────────────

export interface GeneralSettings {
  storeName: string;
  tagline: string;
  supportPhone: string;
  supportEmail: string;
  address: string;
  facebookUrl: string;
  instagramUrl: string;
}

export interface PaymentSettings {
  codEnabled: boolean;
  bkashEnabled: boolean;
  bkashNumber: string;
  nagadEnabled: boolean;
  nagadNumber: string;
  cardEnabled: boolean;
}

export interface ShippingSettings {
  flatRate: number;
  freeShippingThreshold: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  codCharge: number;
}

export interface OrderSettings {
  defaultLowStockThreshold: number;
  allowGuestCheckout: boolean;
  autoConfirmOrders: boolean;
  orderNote: string;
}

export interface SeoSettings {
  defaultTitle: string;
  defaultDescription: string;
  keywords: string;
}

export interface NotificationSettings {
  newOrderAlerts: boolean;
  lowStockAlerts: boolean;
  syncFailureAlerts: boolean;
  reviewAlerts: boolean;
  trackingErrorAlerts: boolean;
}

export const DEFAULT_SETTINGS = {
  general: {
    storeName: "ShopNest",
    tagline: "Everything you love, delivered to your nest",
    supportPhone: "+880 1700-000000",
    supportEmail: "support@shopnest.com.bd",
    address: "House 12, Road 5, Dhanmondi, Dhaka 1205",
    facebookUrl: "https://facebook.com/shopnest",
    instagramUrl: "https://instagram.com/shopnest",
  } satisfies GeneralSettings,
  payment: {
    codEnabled: true,
    bkashEnabled: false,
    bkashNumber: "",
    nagadEnabled: false,
    nagadNumber: "",
    cardEnabled: false,
  } satisfies PaymentSettings,
  shipping: {
    flatRate: 60,
    freeShippingThreshold: 2000,
    estimatedDaysMin: 2,
    estimatedDaysMax: 5,
    codCharge: 0,
  } satisfies ShippingSettings,
  orders: {
    defaultLowStockThreshold: 5,
    allowGuestCheckout: true,
    autoConfirmOrders: false,
    orderNote: "Thank you for shopping with ShopNest!",
  } satisfies OrderSettings,
  seo: {
    // Brand-free on purpose: the layout template appends "| <Store>" exactly once.
    defaultTitle: "Online Shopping in Bangladesh — Everything You Love, Delivered",
    defaultDescription:
      "Shop electronics, fashion, home essentials and more with fast delivery across Bangladesh. Cash on delivery available.",
    keywords: "shopnest, online shopping, bangladesh, electronics, fashion",
  } satisfies SeoSettings,
  notifications: {
    newOrderAlerts: true,
    lowStockAlerts: true,
    syncFailureAlerts: true,
    reviewAlerts: true,
    trackingErrorAlerts: true,
  } satisfies NotificationSettings,
};

export type SettingsKey = keyof typeof DEFAULT_SETTINGS;

type SettingsMap = {
  general: GeneralSettings;
  payment: PaymentSettings;
  shipping: ShippingSettings;
  orders: OrderSettings;
  seo: SeoSettings;
  notifications: NotificationSettings;
};

// ── Cache (short TTL to keep D1/SQLite load low) ───────────────────

const cache = new Map<string, { value: unknown; expires: number }>();
const TTL_MS = 30_000;

export async function getSetting<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as SettingsMap[K];

  const row = await db.setting.findUnique({ where: { key } });
  const value = row
    ? { ...DEFAULT_SETTINGS[key], ...parseJSON<Partial<SettingsMap[K]>>(row.value, {}) }
    : DEFAULT_SETTINGS[key];

  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value as SettingsMap[K];
}

export async function setSetting<K extends SettingsKey>(key: K, patch: Partial<SettingsMap[K]>) {
  const current = await getSetting(key);
  const next = { ...current, ...patch };
  await db.setting.upsert({
    where: { key },
    update: { value: stringifyJSON(next) },
    create: { key, value: stringifyJSON(next) },
  });
  cache.delete(key);
  return next;
}

export function invalidateSettingsCache() {
  cache.clear();
}

// ── Validation schemas (admin settings PATCH) ──────────────────────
// Values arriving from the admin console are validated field-by-field with
// zod — wrong types (e.g. flatRate: "abc") and out-of-range numbers
// (negative shipping) are rejected instead of being persisted.

import { z } from "zod";

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const str = (max: number) => z.string().max(max);

export const SETTINGS_SCHEMAS = {
  general: z
    .object({
      storeName: str(80),
      tagline: str(160),
      supportPhone: str(40),
      supportEmail: z.union([z.email(), z.literal("")]).or(str(120)),
      address: str(240),
      facebookUrl: str(300).optional().nullable(),
      instagramUrl: str(300).optional().nullable(),
    })
    .strict(),
  payment: z
    .object({
      codEnabled: z.coerce.boolean(),
      bkashEnabled: z.coerce.boolean(),
      bkashNumber: str(40),
      nagadEnabled: z.coerce.boolean(),
      nagadNumber: str(40),
      // NOTE: `cardEnabled` is intentionally NOT writable — no card gateway is
      // integrated, and enabling it would strand orders in UNPAID forever.
    })
    .strict(),
  shipping: z
    .object({
      flatRate: int(0, 100_000),
      freeShippingThreshold: int(0, 1_000_000),
      estimatedDaysMin: int(0, 60),
      estimatedDaysMax: int(0, 60),
      codCharge: int(0, 5_000),
    })
    .strict()
    .refine((v) => v.estimatedDaysMin <= v.estimatedDaysMax, {
      message: "Minimum delivery days must not exceed the maximum",
    }),
  orders: z
    .object({
      defaultLowStockThreshold: int(0, 10_000),
      allowGuestCheckout: z.coerce.boolean(),
      autoConfirmOrders: z.coerce.boolean(),
      orderNote: str(500),
    })
    .strict(),
  seo: z
    .object({
      defaultTitle: str(180),
      defaultDescription: str(400),
      keywords: str(400),
    })
    .strict(),
  notifications: z
    .object({
      newOrderAlerts: z.coerce.boolean(),
      lowStockAlerts: z.coerce.boolean(),
      syncFailureAlerts: z.coerce.boolean(),
      reviewAlerts: z.coerce.boolean(),
      trackingErrorAlerts: z.coerce.boolean(),
    })
    .strict(),
} as const;

export type SettingsPatchSchema<K extends SettingsKey> = (typeof SETTINGS_SCHEMAS)[K];


