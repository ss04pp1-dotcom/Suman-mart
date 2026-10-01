import { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────
// Runtime proxy to the shared backend (Cloudflare Workers API).
//
// The storefront is a PURE UI deployment: business logic, auth, checkout and
// admin operations all live on the Workers API (apps/api). Browser fetches
// keep using same-origin /api/* paths (cookies stay first-party — the proxy
// forwards them verbatim in both directions); the proxy maps /api/<x> onto
// the versioned API surface ${BACKEND_ORIGIN}/v1/<x>.
//
// A route handler (not next.config rewrites) because rewrites are baked at
// BUILD time — this reads BACKEND_ORIGIN at REQUEST time, so one build can
// target any environment.
// ─────────────────────────────────────────────────────────────────────────

export const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8787";

/** Headers that must reach the backend verbatim. */
const FORWARD_REQUEST_HEADERS = ["content-type", "cookie", "origin", "x-forwarded-for", "x-forwarded-host", "user-agent", "accept", "accept-language"];

/** Response headers worth copying (content-encoding/length must NOT be). */
const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "location", "retry-after"];

/**
 * Proxy a same-origin /api/<x> request to the Workers API /v1/<x>.
 * @param prefix the same-origin path prefix being proxied (e.g. "/api")
 */
export async function proxyToBackend(req: NextRequest, prefix: string, path: string[]): Promise<Response> {
  const incoming = new URL(req.url);
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = `${BACKEND_ORIGIN}/v1/${suffix}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The API's sameOrigin() CSRF check compares Origin against
  // x-forwarded-host (falling back to host). Behind this proxy the browser's
  // Origin is the STOREFRONT origin, so the original host must be forwarded.
  const originalHost = req.headers.get("host");
  if (originalHost && !headers.get("x-forwarded-host")) headers.set("x-forwarded-host", originalHost);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
    // JSON/API payloads are small — buffer instead of stream-duplexing.
    ...(hasBody ? { body: await req.arrayBuffer() } : {}),
  };

  const res = await fetch(target, init);

  const outHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  // Multiple Set-Cookie headers must survive verbatim (session cookies).
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const cookie of setCookies) outHeaders.append("set-cookie", cookie);

  return new Response(res.body, { status: res.status, headers: outHeaders });
}

/**
 * Proxy a media path (/uploads/…) to the API's R2-backed media route
 * (/v1/media/uploads/…).
 */
export async function proxyMedia(req: NextRequest, prefix: string, path: string[]): Promise<Response> {
  const incoming = new URL(req.url);
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = `${BACKEND_ORIGIN}/v1/media/${prefix.replace(/^\//, "")}/${suffix}`;

  const res = await fetch(target, { method: "GET", headers: { accept: req.headers.get("accept") ?? "*/*" } });

  const outHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "etag"]) {
    const value = res.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

/** Server-side (RSC) GET against the API with the incoming request's cookies. */
export async function apiGet<T>(path: string, cookieHeader?: string | null): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/v1${path}`, {
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        "x-forwarded-host": "server-component",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { success: boolean; data: T };
    return body.success ? body.data : null;
  } catch (e) {
    console.error(`[api-server] GET ${path} failed:`, e);
    return null;
  }
}

// ── RSC bundle contracts (mirror the API's /storefront endpoints) ────

export interface HomeBundle {
  banners: {
    id: string; title: string; subtitle: string | null; imageUrl: string;
    buttonLabel: string | null; buttonUrl: string | null; theme: string; sortOrder: number;
  }[];
  sections: { id: string; key: string; title: string; subtitle: string | null; sortOrder: number }[];
  categories: {
    id: string; name: string; slug: string; imageUrl: string | null; description: string | null;
    _count: { products: number };
  }[];
  featured: ProductRow[];
  newArrivals: ProductRow[];
  bestSellers: ProductRow[];
  specialOffers: ProductRow[];
  topReviews: {
    id: string; authorName: string; rating: number; title: string | null; comment: string;
    createdAt: string; product: { name: string; slug: string };
  }[];
  promoBanner: {
    id: string; title: string; subtitle: string | null; imageUrl: string;
    buttonLabel: string | null; buttonUrl: string | null; theme: string;
  } | null;
}

export interface ProductRow {
  id: string; name: string; slug: string; price: number; compareAtPrice: number | null;
  stock: number; rating: number; reviewCount: number; soldCount: number; brand: string | null;
  categoryId: string | null; createdAt: string;
  images: { url: string; alt: string | null; sortOrder: number }[];
  category: { name: string; slug: string } | null;
}

export interface ProductDetailBundle {
  product: ProductRow & {
    shortDescription: string | null; description: string | null; sku: string;
    specifications: string; seoTitle: string | null; seoDescription: string | null;
    variants: { id: string; name: string; options: string; sku: string | null; price: number | null; stock: number; sortOrder: number }[];
    tags: { tag: { name: string; slug: string } }[];
    reviews: {
      id: string; authorName: string; rating: number; title: string | null; comment: string;
      adminReply: string | null; verifiedPurchase: boolean; isFeatured: boolean; createdAt: string;
    }[];
  };
  shipping: { flatRate: number; freeShippingThreshold: number; estimatedDaysMin: number; estimatedDaysMax: number; codCharge: number };
  relations: { relatedProduct: ProductRow }[];
  fbt: { relatedProduct: ProductRow }[];
  autoRelated: ProductRow[];
  seo: { name: string; seoTitle: string | null; seoDescription: string | null; shortDescription: string | null; firstImage: string | null };
}

export interface OrderRow {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  customerEmail: string | null; status: string; paymentStatus: string; paymentMethod: string;
  subtotal: number; discountTotal: number; shippingTotal: number; codCharge: number; total: number;
  couponCode: string | null; shippingAddress: string; customerNote: string | null;
  purchaseEventId: string | null; courier: string | null; trackingNumber: string | null;
  estimatedDelivery: string | null; createdAt: string;
  items: { id: string; name: string; sku: string; imageUrl: string | null; unitPrice: number; quantity: number; total: number; options: string | null }[];
  statusHistory?: { id: string; status: string; note: string | null; createdAt: string }[];
  supplierOrders?: { id: string; status: string; externalOrderId: string | null; trackingNumber: string | null; courier: string | null; supplier: { name: string } }[];
}

export interface AccountOverview {
  customer: {
    id: string; name: string; email: string; phone: string | null; avatarUrl: string | null;
    createdAt: string; emailVerifiedAt: string | null;
    addresses: {
      id: string; label: string; fullName: string; phone: string; line1: string; line2: string | null;
      city: string; area: string | null; postalCode: string | null; isDefault: boolean;
    }[];
  };
  stats: { orderCount: number; totalSpent: number; activeOrders: number; addressCount: number };
}
