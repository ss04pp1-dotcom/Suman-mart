"use client";

/**
 * ShopNest browser tracking client.
 *
 * Privacy model:
 *  • Nothing is tracked until the user grants consent (essential-only = no tracking)
 *  • Analytics consent → first-party events sent to /api/tracking/events
 *  • Marketing consent → third-party pixels load and receive browser events
 *  • Purchase events share the eventId `purchase_{orderNumber}` with the
 *    server copy, enabling cross-channel deduplication
 */

export type TrackEventName =
  | "PageView"
  | "ViewContent"
  | "Search"
  | "AddToCart"
  | "ViewCart"
  | "InitiateCheckout"
  | "AddPaymentInfo"
  | "Purchase"
  | "AddToWishlist"
  | "SignUp"
  | "Login"
  | "Lead";

export interface TrackPayload {
  productId?: string;
  productName?: string;
  value?: number;
  quantity?: number;
  searchQuery?: string;
  searchResults?: number;
  eventId?: string; // Predefined dedup ID (used by Purchase)
}

const SESSION_COOKIE = "sn_sk";
const SESSION_SIG_COOKIE = "sn_sks";
const UTM_KEY = "sn_utm";

export interface UtmData {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
}

function readCookie(name: string): string | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

/**
 * Signed tracking session key. The pair (sn_sk + sn_sks) is issued by
 * /api/tracking/session and verified server-side — events carrying a key
 * without a valid signature are rejected. Returns "" when unavailable
 * (tracking silently disabled rather than forged).
 */
export async function getSessionKey(): Promise<string> {
  if (typeof window === "undefined") return "";
  const key = readCookie(SESSION_COOKIE);
  const sig = readCookie(SESSION_SIG_COOKIE);
  if (key && sig) return key;
  try {
    const res = await fetch("/api/tracking/session");
    const json = (await res.json()) as { success: boolean; data?: { sessionKey: string } };
    return json.success && json.data ? json.data.sessionKey : "";
  } catch {
    return "";
  }
}

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    ttq?: { track: (name: string, data?: Record<string, unknown>) => void; load: (id: string) => void; page?: () => void };
    _snPixels?: PixelConfig;
  }
}

interface PixelConfig {
  metaPixelId: string | null;
  ga4MeasurementId: string | null;
  gtmId: string | null;
  tiktokPixelId: string | null;
}

let pixelsLoaded = false;

export function captureUtm(): UtmData {
  if (typeof window === "undefined") return {};
  const existing = JSON.parse(localStorage.getItem(UTM_KEY) ?? "null") as UtmData | null;
  if (existing) return existing; // Attribution sticks to the first visit

  const params = new URLSearchParams(window.location.search);
  const data: UtmData = {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    referrer: document.referrer || null,
    landingPath: window.location.pathname,
  };
  const hasUtm = data.utmSource || data.utmMedium || data.utmCampaign;
  if (hasUtm || document.referrer) {
    localStorage.setItem(UTM_KEY, JSON.stringify(data));
  }
  return data;
}

function getConsent() {
  if (typeof window === "undefined") return { analytics: false, marketing: false, decided: false };
  try {
    const raw = localStorage.getItem("sn-consent");
    if (!raw) return { analytics: false, marketing: false, decided: false };
    const parsed = JSON.parse(raw) as { state?: { analytics?: boolean; marketing?: boolean; decided?: boolean } };
    return {
      analytics: parsed.state?.analytics ?? false,
      marketing: parsed.state?.marketing ?? false,
      decided: parsed.state?.decided ?? false,
    };
  } catch {
    return { analytics: false, marketing: false, decided: false };
  }
}

/** Fire the browser-side copies to Meta / GA4 / TikTok (marketing consent required). */
function fireBrowserPixels(name: TrackEventName, payload: TrackPayload, eventId: string) {
  const GA4_MAP: Partial<Record<TrackEventName, string>> = {
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
  const TT_MAP: Partial<Record<TrackEventName, string>> = {
    PageView: "Pageview",
    ViewContent: "ViewContent",
    Search: "Search",
    AddToCart: "AddToCart",
    InitiateCheckout: "InitiateCheckout",
    AddPaymentInfo: "AddPaymentInfo",
    Purchase: "PlaceAnOrder",
    AddToWishlist: "AddToWishlist",
    SignUp: "CompleteRegistration",
  };

  const itemData = payload.productId
    ? {
        content_ids: [payload.productId],
        content_name: payload.productName,
        content_type: "product",
        value: payload.value,
        currency: "BDT",
      }
    : { value: payload.value, currency: "BDT" };

  try {
    window.fbq?.("track", name === "SignUp" ? "CompleteRegistration" : name, { ...itemData, eventID: eventId });
  } catch { /* pixels never break the store */ }
  try {
    window.gtag?.("event", GA4_MAP[name] ?? name, {
      event_id: eventId,
      value: payload.value,
      currency: "BDT",
      search_term: payload.searchQuery,
      items: payload.productId ? [{ item_id: payload.productId, item_name: payload.productName }] : undefined,
    });
  } catch { /* ignore */ }
  try {
    window.ttq?.track(TT_MAP[name] ?? name, { ...itemData, event_id: eventId });
  } catch { /* ignore */ }
}

/** Send the first-party event to ShopNest's own collector (analytics consent required). */
async function sendFirstParty(name: TrackEventName, payload: TrackPayload, eventId: string) {
  try {
    const sessionKey = await getSessionKey();
    if (!sessionKey) return; // no signed session → collector would reject anyway
    await fetch("/api/tracking/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { sessionKey, ...captureUtm() },
        events: [
          {
            eventId,
            name,
            url: window.location.pathname + window.location.search,
            ...payload,
          },
        ],
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch { /* ignore */ }
}

/** Track a user interaction. No-ops until the user grants analytics consent. */
export function track(name: TrackEventName, payload: TrackPayload = {}) {
  if (typeof window === "undefined") return;
  const consent = getConsent();
  if (!consent.analytics && !consent.marketing) return;

  const eventId = payload.eventId ?? crypto.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (consent.marketing) fireBrowserPixels(name, payload, eventId);
  if (consent.analytics) void sendFirstParty(name, payload, eventId);
}

/** Load third-party pixel scripts once marketing consent is granted. */
let loadPixelsInflight = false;
const initializedPixelIds = new Set<string>();

export async function loadPixels() {
  if (typeof window === "undefined" || pixelsLoaded || loadPixelsInflight) return;
  const consent = getConsent();
  if (!consent.marketing) return;
  loadPixelsInflight = true; // synchronous mutex — prevents concurrent double-init

  try {
    const res = await fetch("/api/settings/public");
    const json = (await res.json()) as { success: boolean; data?: { pixels: PixelConfig } };
    if (!json.success || !json.data) return;
    const pixels = json.data.pixels;
    pixelsLoaded = true;

    // Meta Pixel — uses the EXACT official base-code structure (including the
    // `_fbq` / `callMethod` markers). A hand-rolled stub without those markers
    // makes the real SDK log "Multiple pixels with conflicting versions".
    if (pixels.metaPixelId) {
      (function (f: Window & { fbq?: NonNullable<Window["fbq"]>; _fbq?: unknown }, d: Document, e: string, v: string) {
        if (f.fbq) return;
        const n = function (...args: unknown[]) {
          const fn = (n as unknown as { callMethod?: (...a: unknown[]) => void }).callMethod;
          if (fn) fn.apply(n, args);
          else (n as unknown as { queue?: unknown[][] }).queue!.push(args);
        } as NonNullable<Window["fbq"]> & { callMethod?: unknown; push?: unknown; queue?: unknown[][]; _fbq?: unknown };
        n.queue = [];
        n.loaded = true;
        n.version = "2.0";
        f.fbq = n;
        if (!f._fbq) f._fbq = n;
        const t = d.createElement("script") as HTMLScriptElement;
        t.async = true;
        t.src = v;
        t.id = "fb-pixel";
        const s = d.getElementsByTagName("script")[0];
        s?.parentNode?.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      if (!initializedPixelIds.has(pixels.metaPixelId)) {
        initializedPixelIds.add(pixels.metaPixelId);
        window.fbq?.("init", pixels.metaPixelId);
        window.fbq?.("track", "PageView");
      }
    }

    // GA4
    if (pixels.ga4MeasurementId || pixels.gtmId) {
      const id = pixels.gtmId ? `gtm-${pixels.gtmId}` : `ga4-${pixels.ga4MeasurementId}`;
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${pixels.ga4MeasurementId ?? pixels.gtmId}`;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = function gtag(...args: unknown[]) {
        window.dataLayer!.push(args);
      };
      window.gtag("js", new Date());
      if (pixels.ga4MeasurementId) window.gtag("config", pixels.ga4MeasurementId, { send_page_view: false });
      if (pixels.gtmId) window.gtag("config", pixels.gtmId);
      void id;
    }

    // TikTok
    if (pixels.tiktokPixelId) {
      const s = document.createElement("script");
      s.async = true;
      s.innerHTML = `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pixels.tiktokPixelId}');ttq.page();}(window,document,'ttq');`;
      document.head.appendChild(s);
    }
  } catch {
    /* pixel loading must never break the storefront */
  } finally {
    // allow a retry only if loading never completed (fetch/script failure);
    // once pixelsLoaded latched true this flag becomes irrelevant.
    loadPixelsInflight = false;
  }
}
