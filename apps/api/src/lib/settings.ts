// Public store settings — D1 port of apps/storefront src/lib/settings.ts
// (read path only). Stored rows are JSON strings keyed by setting group; the
// defaults below mirror DEFAULT_SETTINGS exactly so an empty database answers
// with the same shape the storefront serves.

import type { Env } from "../env";
import { parseJSON, toBool, toStr } from "./d1";

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

const DEFAULTS = {
  general: {
    storeName: "ShopNest",
    tagline: "Everything you love, delivered to your nest",
    supportPhone: "+880 1700-000000",
    supportEmail: "support@shopnest.com.bd",
    address: "House 12, Road 5, Dhanmondi, Dhaka 1205",
    facebookUrl: "https://facebook.com/shopnest",
    instagramUrl: "https://instagram.com/shopnest",
  },
  payment: {
    codEnabled: true,
    bkashEnabled: false,
    bkashNumber: "",
    nagadEnabled: false,
    nagadNumber: "",
    cardEnabled: false,
  },
  shipping: {
    flatRate: 60,
    freeShippingThreshold: 2000,
    estimatedDaysMin: 2,
    estimatedDaysMax: 5,
    codCharge: 0,
  },
} satisfies Record<"general" | "payment" | "shipping", unknown>;

type AnyRecord = Record<string, unknown>;

async function getSettingGroup(env: Env, key: string): Promise<AnyRecord> {
  const row = await env.DB.prepare(`SELECT "value" AS value FROM Setting WHERE "key" = ?`).bind(key).first<{ value: string }>();
  if (!row) return {};
  return parseJSON<AnyRecord>(row.value, {});
}

function merge<T extends AnyRecord>(fallback: T, stored: AnyRecord): T {
  const out: AnyRecord = { ...fallback };
  for (const k of Object.keys(fallback)) {
    if (stored[k] !== undefined) out[k] = stored[k];
  }
  return out as T;
}

export async function getGeneral(env: Env): Promise<GeneralSettings> {
  const s = merge(DEFAULTS.general as AnyRecord, await getSettingGroup(env, "general"));
  return {
    storeName: toStr(s.storeName),
    tagline: toStr(s.tagline),
    supportPhone: toStr(s.supportPhone),
    supportEmail: toStr(s.supportEmail),
    address: toStr(s.address),
    facebookUrl: toStr(s.facebookUrl),
    instagramUrl: toStr(s.instagramUrl),
  };
}

export async function getPayment(env: Env): Promise<PaymentSettings> {
  const s = merge(DEFAULTS.payment as AnyRecord, await getSettingGroup(env, "payment"));
  return {
    codEnabled: toBool(s.codEnabled),
    bkashEnabled: toBool(s.bkashEnabled),
    bkashNumber: toStr(s.bkashNumber),
    nagadEnabled: toBool(s.nagadEnabled),
    nagadNumber: toStr(s.nagadNumber),
    cardEnabled: toBool(s.cardEnabled),
  };
}

export async function getShipping(env: Env): Promise<ShippingSettings> {
  const s = merge(DEFAULTS.shipping as AnyRecord, await getSettingGroup(env, "shipping"));
  return {
    flatRate: Number(s.flatRate) || 0,
    freeShippingThreshold: Number(s.freeShippingThreshold) || 0,
    estimatedDaysMin: Number(s.estimatedDaysMin) || 0,
    estimatedDaysMax: Number(s.estimatedDaysMax) || 0,
    codCharge: Number(s.codCharge) || 0,
  };
}

/** Browser pixel IDs only — secrets never leave the server. */
export async function getBrowserPixels(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT "provider" AS provider, "config" AS config, "isEnabled" AS isEnabled
     FROM TrackingIntegration WHERE "provider" IN ('META','GOOGLE','TIKTOK')`
  ).all<{ provider: string; config: string; isEnabled: number }>();

  const byProvider = new Map(
    (rows.results ?? []).map((r) => [r.provider, { config: parseJSON<AnyRecord>(r.config, {}), enabled: toBool(r.isEnabled) }])
  );
  const meta = byProvider.get("META");
  const google = byProvider.get("GOOGLE");
  const tiktok = byProvider.get("TIKTOK");

  return {
    metaPixelId: meta?.enabled ? toStr(meta.config.pixelId) || null : null,
    ga4MeasurementId: google?.enabled ? toStr(google.config.ga4MeasurementId) || null : null,
    gtmId: google?.enabled ? toStr(google.config.gtmId) || null : null,
    tiktokPixelId: tiktok?.enabled ? toStr(tiktok.config.pixelId) || null : null,
  };
}
