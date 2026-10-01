// Admin settings, maintenance, notifications, upload — Hono port of the
// corresponding apps/storefront/src/app/api/admin/* routes.

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { getSetting, setSetting, invalidateSettingsCache, SETTINGS_SCHEMAS } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { getIntegration, saveIntegration, testIntegration, type PixelProvider } from "@/lib/pixels";
import { saveUpload } from "@/lib/storage";
import { maybeRunRetention } from "@/lib/tracking";
import { retryFailedSupplierOrders } from "@/lib/suppliers/orders";
import { z } from "zod";

// ── Settings (store + tracking) ────────────────────────────────────

export const adminSettingsApi = new Hono<{ Bindings: Env }>();

const SETTING_KEYS = ["general", "payment", "shipping", "orders", "seo", "notifications"] as const;

adminSettingsApi.get("/", async (c) => {
  await requireAdmin(c, "settings.view");

  const url = new URL(c.req.url);
  const key = url.searchParams.get("key");

  if (key === "tracking") {
    const [meta, google, tiktok, custom] = await Promise.all([
      getIntegration("META"), getIntegration("GOOGLE"), getIntegration("TIKTOK"), getIntegration("CUSTOM"),
    ]);
    const mask = (i: typeof meta) => ({
      provider: i.provider, config: i.config, isEnabled: i.isEnabled, status: i.status,
      lastError: i.lastError, lastCheckedAt: i.lastCheckedAt,
      hasAccessToken: Boolean(i.secrets.accessToken), hasApiSecret: Boolean(i.secrets.apiSecret),
      testEventCode: i.secrets.testEventCode ?? "",
    });
    return ok(c, { meta: mask(meta), google: mask(google), tiktok: mask(tiktok), custom: mask(custom) });
  }

  const keys = key && (SETTING_KEYS as readonly string[]).includes(key) ? [key as (typeof SETTING_KEYS)[number]] : [...SETTING_KEYS];
  const result: Record<string, unknown> = {};
  for (const k of keys) result[k] = await getSetting(k);
  return ok(c, result);
});

const patchSchema = z.object({
  key: z.enum(["general", "payment", "shipping", "orders", "seo", "notifications"]),
  values: z.record(z.string(), z.unknown()),
});

const trackingSchema = z.object({
  provider: z.enum(["META", "GOOGLE", "TIKTOK", "CUSTOM"]),
  config: z.record(z.string(), z.string().optional()).optional(),
  secrets: z.record(z.string(), z.string().optional()).optional(),
  isEnabled: z.boolean().optional(),
});

adminSettingsApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "settings.manage");

  const body = await c.req.json().catch(() => null);
  if (!body) return fail(c, "Invalid request body", 422);

  // Tracking & pixels
  if (body.key === "tracking" || body.provider) {
    const parsed = trackingSchema.safeParse(body);
    if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid tracking settings", 422);
    const { provider, config, secrets, isEnabled } = parsed.data;
    const updated = await saveIntegration(provider as PixelProvider, {
      config: config as Record<string, string | undefined>,
      secrets: secrets as Record<string, string | undefined>,
      isEnabled,
    });
    await writeAudit(guard.admin.id, "settings.tracking_updated", "settings", provider, { isEnabled });
    return ok(c, { provider: updated.provider, isEnabled: updated.isEnabled, status: updated.status });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid settings", 422);
  const { key, values } = parsed.data;

  // Validate the patch against the typed schema for this settings group —
  // wrong types (e.g. flatRate as string), unknown fields and out-of-range
  // numbers are rejected before anything is persisted.
  const schema = SETTINGS_SCHEMAS[key];
  const valid = schema.safeParse(values);
  if (!valid.success) {
    return fail(c, valid.error.issues[0]?.message ?? "Invalid settings values", 422);
  }
  const patch = valid.data as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return fail(c, "No valid settings fields provided", 422);

  const next = await setSetting(key, patch);
  invalidateSettingsCache();
  await writeAudit(guard.admin.id, "settings.updated", "settings", key, { fields: Object.keys(patch) });
  return ok(c, next);
});

// POST /v1/admin/settings/test-integration — live pixel connectivity test
adminSettingsApi.post("/test-integration", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "tracking.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ provider: z.enum(["META", "GOOGLE", "TIKTOK", "CUSTOM"]) }).safeParse(body);
  if (!parsed.success) return fail(c, "Invalid provider", 422);

  const result = await testIntegration(parsed.data.provider as PixelProvider);
  await writeAudit(guard.admin.id, "tracking.test_integration", "settings", parsed.data.provider, { ok: result.ok });
  return ok(c, result);
});

// ── Maintenance ────────────────────────────────────────────────────

export const adminMaintenanceApi = new Hono<{ Bindings: Env }>();

/**
 * Operator maintenance actions (settings permission required):
 *  • retention — force-prune tracking events/sessions older than 180 days
 *  • retry-supplier-orders — re-run failed supplier placements
 */
adminMaintenanceApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "settings.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ action: z.enum(["retention", "retry-supplier-orders"]) }).safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid action", 422);

  if (parsed.data.action === "retention") {
    const result = await maybeRunRetention(true);
    await writeAudit(guard.admin.id, "maintenance.retention", "maintenance", "tracking", { ...result });
    return ok(c, result);
  }

  const result = await retryFailedSupplierOrders();
  await writeAudit(guard.admin.id, "maintenance.supplier_retry", "maintenance", "supplier_orders", { ...result });
  return ok(c, result);
});

// ── Notifications ──────────────────────────────────────────────────

export const adminNotificationsApi = new Hono<{ Bindings: Env }>();

adminNotificationsApi.get("/", async (c) => {
  await requireAdmin(c, "dashboard.view");

  const [notifications, unread] = await Promise.all([
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.notification.count({ where: { isRead: false } }),
  ]);
  return ok(c, { notifications, unread });
});

adminNotificationsApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  await requireAdmin(c, "dashboard.view");

  const body = await c.req.json().catch(() => null);
  const { id, all } = body ?? {};
  if (all) {
    await db.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
    return ok(c, { updated: "all" });
  }
  if (!id) return fail(c, "Notification ID required", 422);
  await db.notification.update({ where: { id }, data: { isRead: true } });
  return ok(c, { updated: id });
});

// ── Image upload (R2) ──────────────────────────────────────────────

export const adminUploadApi = new Hono<{ Bindings: Env }>();

adminUploadApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const folder = String(form?.get("folder") ?? "products");

  if (!(file instanceof File)) return fail(c, "No file provided", 422);
  if (!["products", "banners", "categories", "misc"].includes(folder)) return fail(c, "Invalid folder", 422);

  try {
    const url = await saveUpload(file, folder);
    await writeAudit(guard.admin.id, "image.uploaded", "storage", null, { folder, name: file.name });
    return ok(c, { url });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Upload failed", 400);
  }
});
