import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { getSetting, setSetting, invalidateSettingsCache, SETTINGS_SCHEMAS } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { getIntegration, saveIntegration, type PixelProvider } from "@/lib/pixels";
import { z } from "zod";
import { NextResponse } from "next/server";

const SETTING_KEYS = ["general", "payment", "shipping", "orders", "seo", "notifications"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("settings.view");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
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
    return ok({ meta: mask(meta), google: mask(google), tiktok: mask(tiktok), custom: mask(custom) });
  }

  const keys = key && (SETTING_KEYS as readonly string[]).includes(key) ? [key as (typeof SETTING_KEYS)[number]] : [...SETTING_KEYS];
  const result: Record<string, unknown> = {};
  for (const k of keys) result[k] = await getSetting(k);
  return ok(result);
}

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

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("settings.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  if (!body) return fail("Invalid request body", 422);

  // Tracking & pixels
  if (body.key === "tracking" || body.provider) {
    const parsed = trackingSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid tracking settings", 422);
    const { provider, config, secrets, isEnabled } = parsed.data;
    const updated = await saveIntegration(provider as PixelProvider, {
      config: config as Record<string, string | undefined>,
      secrets: secrets as Record<string, string | undefined>,
      isEnabled,
    });
    await writeAudit(guard.admin.id, "settings.tracking_updated", "settings", provider, { isEnabled });
    return ok({ provider: updated.provider, isEnabled: updated.isEnabled, status: updated.status });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings", 422);
  const { key, values } = parsed.data;

  // Validate the patch against the typed schema for this settings group —
  // wrong types (e.g. flatRate as string), unknown fields and out-of-range
  // numbers are rejected before anything is persisted.
  const schema = SETTINGS_SCHEMAS[key];
  const valid = schema.safeParse(values);
  if (!valid.success) {
    return fail(valid.error.issues[0]?.message ?? "Invalid settings values", 422, {
      field: valid.error.issues[0]?.path.join("."),
    });
  }
  const patch = valid.data as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return fail("No valid settings fields provided", 422);

  const next = await setSetting(key, patch);
  invalidateSettingsCache();
  await writeAudit(guard.admin.id, "settings.updated", "settings", key, { fields: Object.keys(patch) });
  return ok(next);
}
