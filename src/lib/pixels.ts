import { db } from "@/lib/db";
import { parseJSON, stringifyJSON } from "@/lib/json";
import { notify } from "@/lib/notifications";
import { assertSafeOutboundUrl, UrlGuardError } from "@/lib/url-guard";

// ─────────────────────────────────────────────────────────────────────────
// Tracking pixel integrations (Meta, Google, TikTok, Custom webhook).
// Secrets live server-side only. Browser scripts receive public IDs only.
// ─────────────────────────────────────────────────────────────────────────

export type PixelProvider = "META" | "GOOGLE" | "TIKTOK" | "CUSTOM";

export interface IntegrationConfig {
  // META: { pixelId }, GOOGLE: { ga4MeasurementId, adsConversionId, conversionLabel, gtmId },
  // TIKTOK: { pixelId }, CUSTOM: { endpoint, headerName }
  [key: string]: string | undefined;
}

export interface IntegrationSecrets {
  [key: string]: string | undefined;
}

export interface Integration {
  provider: PixelProvider;
  config: IntegrationConfig;
  secrets: IntegrationSecrets;
  isEnabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
}

const DEFAULT_CONFIGS: Record<PixelProvider, IntegrationConfig> = {
  META: { pixelId: "" },
  GOOGLE: { ga4MeasurementId: "", adsConversionId: "", conversionLabel: "", gtmId: "" },
  TIKTOK: { pixelId: "" },
  CUSTOM: { endpoint: "", headerName: "X-Api-Key" },
};

export async function getIntegration(provider: PixelProvider): Promise<Integration> {
  let row = await db.trackingIntegration.findUnique({ where: { provider } });
  if (!row) {
    row = await db.trackingIntegration.create({
      data: {
        provider,
        config: stringifyJSON(DEFAULT_CONFIGS[provider]),
        secrets: stringifyJSON({}),
      },
    });
  }
  return {
    provider,
    config: parseJSON<IntegrationConfig>(row.config, DEFAULT_CONFIGS[provider]),
    secrets: parseJSON<IntegrationSecrets>(row.secrets, {}),
    isEnabled: row.isEnabled,
    status: row.status,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
  };
}

export async function saveIntegration(
  provider: PixelProvider,
  patch: { config?: IntegrationConfig; secrets?: IntegrationSecrets; isEnabled?: boolean }
) {
  const current = await getIntegration(provider);
  const config = { ...current.config, ...(patch.config ?? {}) };
  const secrets = { ...current.secrets, ...(patch.secrets ?? {}) };
  // Blank secret fields mean "keep existing" — only overwrite when a non-empty value arrives
  for (const k of Object.keys(secrets)) {
    if (patch.secrets?.[k] === "") delete secrets[k];
  }
  await db.trackingIntegration.update({
    where: { provider },
    data: {
      config: stringifyJSON(config),
      secrets: stringifyJSON(secrets),
      isEnabled: patch.isEnabled ?? current.isEnabled,
      status: patch.isEnabled ?? current.isEnabled ? (current.status === "DISABLED" ? "CONNECTED" : current.status) : "DISABLED",
    },
  });
  return getIntegration(provider);
}

/** Public pixel config for the storefront browser scripts — secrets stripped. */
export async function getBrowserPixels() {
  const [meta, google, tiktok] = await Promise.all([
    getIntegration("META"),
    getIntegration("GOOGLE"),
    getIntegration("TIKTOK"),
  ]);
  return {
    metaPixelId: meta.isEnabled && meta.config.pixelId ? meta.config.pixelId : null,
    ga4MeasurementId: google.isEnabled && google.config.ga4MeasurementId ? google.config.ga4MeasurementId : null,
    gtmId: google.isEnabled && google.config.gtmId ? google.config.gtmId : null,
    tiktokPixelId: tiktok.isEnabled && tiktok.config.pixelId ? tiktok.config.pixelId : null,
  };
}

// ── Event normalization ───────────────────────────────────────────

export interface TrackedEvent {
  eventId: string;
  name: string;
  url?: string | null;
  value?: number | null;
  currency?: string;
  productId?: string | null;
  productName?: string | null;
  quantity?: number | null;
  searchQuery?: string | null;
  eventTime: Date;
  clientIp?: string;
  userAgent?: string;
  source: "BROWSER" | "SERVER";
}

const META_EVENT: Record<string, string> = {
  PageView: "PageView",
  ViewContent: "ViewContent",
  Search: "Search",
  AddToCart: "AddToCart",
  ViewCart: "ViewCart",
  InitiateCheckout: "InitiateCheckout",
  AddPaymentInfo: "AddPaymentInfo",
  Purchase: "Purchase",
  AddToWishlist: "AddToWishlist",
  SignUp: "CompleteRegistration",
  Login: "Login",
  Lead: "Lead",
};

const GA4_EVENT: Record<string, string> = {
  PageView: "page_view",
  ViewContent: "view_item",
  Search: "search",
  AddToCart: "add_to_cart",
  ViewCart: "view_cart",
  InitiateCheckout: "begin_checkout",
  AddPaymentInfo: "add_payment_info",
  Purchase: "purchase",
  AddToWishlist: "add_to_wishlist",
  SignUp: "sign_up",
  Login: "login",
  Lead: "generate_lead",
};

const TIKTOK_EVENT: Record<string, string> = {
  PageView: "Pageview",
  ViewContent: "ViewContent",
  Search: "Search",
  AddToCart: "AddToCart",
  ViewCart: "ViewCart",
  InitiateCheckout: "InitiateCheckout",
  AddPaymentInfo: "AddPaymentInfo",
  Purchase: "PlaceAnOrder",
  AddToWishlist: "AddToWishlist",
  SignUp: "CompleteRegistration",
  Login: "Login",
  Lead: "SubmitForm",
};

export interface DeliveryResult {
  status: "SUCCESS" | "ERROR" | "SKIPPED";
  error?: string;
}

// ── Meta Conversions API ──────────────────────────────────────────

async function forwardToMeta(integration: Integration, events: TrackedEvent[]): Promise<DeliveryResult> {
  const pixelId = integration.config.pixelId;
  const accessToken = integration.secrets.accessToken;
  if (!integration.isEnabled || !pixelId || !accessToken) return { status: "SKIPPED" };

  try {
    const body = {
      data: events.map((e) => ({
        event_name: META_EVENT[e.name] ?? e.name,
        event_time: Math.floor(e.eventTime.getTime() / 1000),
        event_id: e.eventId,
        event_source_url: e.url ?? undefined,
        action_source: "website",
        user_data: {
          client_ip_address: e.clientIp,
          client_user_agent: e.userAgent,
        },
        custom_data: {
          currency: e.currency ?? "BDT",
          value: e.value ?? undefined,
          contents:
            e.productId || e.productName
              ? [{ id: e.productId ?? e.productName, quantity: e.quantity ?? 1 }]
              : undefined,
          search_string: e.searchQuery ?? undefined,
        },
      })),
      test_event_code: integration.secrets.testEventCode || undefined,
    };

    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok || json.error) {
      const message = json.error?.message ?? `HTTP ${res.status}`;
      await recordIntegrationError("META", message);
      return { status: "ERROR", error: message };
    }
    return { status: "SUCCESS" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    await recordIntegrationError("META", message);
    return { status: "ERROR", error: message };
  }
}

// ── GA4 Measurement Protocol ──────────────────────────────────────

async function forwardToGA4(integration: Integration, events: TrackedEvent[]): Promise<DeliveryResult> {
  const measurementId = integration.config.ga4MeasurementId;
  const apiSecret = integration.secrets.apiSecret;
  if (!integration.isEnabled || !measurementId || !apiSecret) return { status: "SKIPPED" };

  try {
    const body = {
      events: events.map((e) => ({
        name: GA4_EVENT[e.name] ?? e.name,
        params: {
          event_id: e.eventId,
          transaction_id: e.name === "Purchase" ? e.eventId.replace("purchase_", "") : undefined,
          value: e.value ?? undefined,
          currency: e.currency ?? "BDT",
          items:
            e.productId || e.productName
              ? [{ item_id: e.productId ?? e.productName, item_name: e.productName ?? undefined, quantity: e.quantity ?? 1 }]
              : undefined,
          search_term: e.searchQuery ?? undefined,
        },
      })),
    };

    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }
    );
    // MP returns 2xx even for some auth issues; use debug endpoint signal only for health checks
    if (!res.ok) {
      const message = `GA4 MP HTTP ${res.status}`;
      await recordIntegrationError("GOOGLE", message);
      return { status: "ERROR", error: message };
    }
    return { status: "SUCCESS" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    await recordIntegrationError("GOOGLE", message);
    return { status: "ERROR", error: message };
  }
}

// ── TikTok Events API ─────────────────────────────────────────────

async function forwardToTikTok(integration: Integration, events: TrackedEvent[]): Promise<DeliveryResult> {
  const pixelId = integration.config.pixelId;
  const accessToken = integration.secrets.accessToken;
  if (!integration.isEnabled || !pixelId || !accessToken) return { status: "SKIPPED" };

  try {
    const body = {
      event_source: "web",
      event_source_id: pixelId,
      events: events.map((e) => ({
        event: TIKTOK_EVENT[e.name] ?? e.name,
        event_time: Math.floor(e.eventTime.getTime() / 1000),
        event_id: e.eventId,
        user: {},
        page: { url: e.url ?? undefined },
        properties: {
          currency: e.currency ?? "BDT",
          value: e.value ?? undefined,
          contents:
            e.productId || e.productName
              ? [{ content_id: e.productId ?? e.productName, content_name: e.productName ?? undefined, quantity: e.quantity ?? 1 }]
              : undefined,
          query: e.searchQuery ?? undefined,
        },
      })),
      test_event_code: integration.secrets.testEventCode || undefined,
    };

    const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!res.ok || (json.code && json.code !== 0)) {
      const message = json.message ?? `HTTP ${res.status}`;
      await recordIntegrationError("TIKTOK", message);
      return { status: "ERROR", error: message };
    }
    return { status: "SUCCESS" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    await recordIntegrationError("TIKTOK", message);
    return { status: "ERROR", error: message };
  }
}

async function forwardToCustom(integration: Integration, events: TrackedEvent[]): Promise<DeliveryResult> {
  const endpoint = integration.config.endpoint;
  if (!integration.isEnabled || !endpoint) return { status: "SKIPPED" };
  try {
    // SSRF guard: only https webhooks whose host resolves to a public address
    const url = await assertSafeOutboundUrl(endpoint);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (integration.secrets.apiKey) headers[integration.config.headerName || "X-Api-Key"] = integration.secrets.apiKey;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "shopnest", events }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: "ERROR", error: `HTTP ${res.status}` };
    return { status: "SUCCESS" };
  } catch (e) {
    if (e instanceof UrlGuardError) return { status: "ERROR", error: `Blocked webhook URL: ${e.message}` };
    return { status: "ERROR", error: e instanceof Error ? e.message : "network error" };
  }
}

async function recordIntegrationError(provider: PixelProvider, message: string) {
  await db.trackingIntegration.update({
    where: { provider },
    data: { status: "ERROR", lastError: message, lastCheckedAt: new Date() },
  }).catch(() => undefined);
  await notify("TRACKING", `${provider} delivery failed`, message.slice(0, 240));
}

export interface PixelDelivery {
  meta: DeliveryResult;
  ga4: DeliveryResult;
  tiktok: DeliveryResult;
  custom: DeliveryResult;
}

/** Forward a batch of events to every enabled provider. */
export async function forwardEventToPixels(events: TrackedEvent[]): Promise<PixelDelivery> {
  const [meta, google, tiktok, custom] = await Promise.all([
    getIntegration("META"),
    getIntegration("GOOGLE"),
    getIntegration("TIKTOK"),
    getIntegration("CUSTOM"),
  ]);
  const [metaResult, ga4Result, tiktokResult, customResult] = await Promise.all([
    forwardToMeta(meta, events),
    forwardToGA4(google, events),
    forwardToTikTok(tiktok, events),
    forwardToCustom(custom, events),
  ]);
  return { meta: metaResult, ga4: ga4Result, tiktok: tiktokResult, custom: customResult };
}

/** Real connectivity test for the admin Pixel Health panel. */
export async function testIntegration(provider: PixelProvider): Promise<{ ok: boolean; message: string }> {
  const integration = await getIntegration(provider);
  const now = new Date();
  const testEvent: TrackedEvent = {
    eventId: `test_${Date.now()}`,
    name: "Lead",
    eventTime: now,
    currency: "BDT",
    source: "SERVER",
    userAgent: "ShopNest-HealthCheck/1.0",
  };

  let result: DeliveryResult = { status: "SKIPPED" };
  if (provider === "META") {
    if (!integration.config.pixelId) return { ok: false, message: "Meta Pixel ID is not configured" };
    if (!integration.secrets.accessToken) {
      await db.trackingIntegration.update({
        where: { provider: "META" },
        data: { status: "CONNECTED", lastError: null, lastCheckedAt: now },
      });
      return { ok: true, message: "Meta Pixel is configured (browser). Conversions API token not set — server events not forwarded." };
    }
    result = await forwardToMeta(integration, [testEvent]);
  } else if (provider === "GOOGLE") {
    if (!integration.config.ga4MeasurementId) return { ok: false, message: "GA4 Measurement ID is not configured" };
    if (integration.secrets.apiSecret) {
      try {
        const res = await fetch(
          `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(integration.config.ga4MeasurementId)}&api_secret=${encodeURIComponent(integration.secrets.apiSecret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: [{ name: "health_check", params: {} }] }),
            signal: AbortSignal.timeout(10_000),
          }
        );
        const json = (await res.json().catch(() => ({}))) as { validationMessages?: { message?: string }[] };
        const fatal = json.validationMessages?.find((m) => /secret|permission|measurement/i.test(m.message ?? ""));
        result = fatal ? { status: "ERROR", error: fatal.message } : { status: "SUCCESS" };
      } catch (e) {
        result = { status: "ERROR", error: e instanceof Error ? e.message : "network error" };
      }
    } else {
      await db.trackingIntegration.update({
        where: { provider: "GOOGLE" },
        data: { status: "CONNECTED", lastError: null, lastCheckedAt: now },
      });
      return { ok: true, message: "GA4 tag is configured (browser). Measurement Protocol secret not set — server events not forwarded." };
    }
  } else if (provider === "TIKTOK") {
    if (!integration.config.pixelId) return { ok: false, message: "TikTok Pixel ID is not configured" };
    if (!integration.secrets.accessToken) {
      await db.trackingIntegration.update({
        where: { provider: "TIKTOK" },
        data: { status: "CONNECTED", lastError: null, lastCheckedAt: now },
      });
      return { ok: true, message: "TikTok Pixel is configured (browser). Events API token not set — server events not forwarded." };
    }
    result = await forwardToTikTok(integration, [testEvent]);
  } else {
    result = await forwardToCustom(integration, [testEvent]);
  }

  const okResult = result.status === "SUCCESS";
  await db.trackingIntegration.update({
    where: { provider },
    data: {
      status: result.status === "SUCCESS" ? "CONNECTED" : result.status === "ERROR" ? "ERROR" : "DISABLED",
      lastError: result.error ?? null,
      lastCheckedAt: now,
    },
  });
  return {
    ok: okResult,
    message: okResult ? "Connection verified successfully." : result.error ?? "Not configured.",
  };
}
