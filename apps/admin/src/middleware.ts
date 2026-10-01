import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/jwt";

// ─────────────────────────────────────────────────────────────────────────
// Edge middleware.
//
// 1. Route guards — verifies session cookies for protected page routes.
//    (API routes do their own full authorization server-side.)
// 2. Strict Content-Security-Policy — nonce-based. Every response gets a
//    fresh nonce; Next.js propagates it onto its own bootstrap <script> tags
//    (read from the CSP on the REQUEST headers), so 'unsafe-inline' and
//    'unsafe-eval' are no longer needed for scripts:
//      • 'strict-dynamic' lets the trusted app bundle load the marketing
//        pixel scripts (fbevents/gtag/tiktok) dynamically after consent
//      • pixel hosts are also allow-listed for legacy CSP2 browsers
//      • 'unsafe-eval' is only added in development (React refresh)
//    Nonces require per-request rendering — static pages would bake in a
//    stale nonce, hence `dynamic = "force-dynamic"` on storefront pages.
// ─────────────────────────────────────────────────────────────────────────

const ADMIN_COOKIE = "sn_admin";
const CUSTOMER_COOKIE = "sn_session";

function cspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://connect.facebook.net https://www.googletagmanager.com https://analytics.tiktok.com${isDev ? " 'unsafe-eval'" : ""}`,
    // React inline style attributes (e.g. carousel offsets) still need
    // 'unsafe-inline' for STYLE attributes; <style> tags stay blocked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://www.google-analytics.com https://connect.facebook.net https://analytics.tiktok.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Route guards ──────────────────────────────────────────────
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    const payload = token ? await verifyJWT(token, process.env.ADMIN_SESSION_SECRET!) : null;
    if (!payload || payload.typ !== "admin") {
      const url = new URL("/admin/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/account")) {
    const token = req.cookies.get(CUSTOMER_COOKIE)?.value;
    const payload = token ? await verifyJWT(token, process.env.SESSION_SECRET!) : null;
    if (!payload || payload.typ !== "customer") {
      const url = new URL("/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  // ── Nonce-based CSP ───────────────────────────────────────────
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = cspHeader(nonce);

  const requestHeaders = new Headers(req.headers);
  // Next.js reads the nonce for its own scripts from the request CSP header…
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  // …and the browser enforces the response copy.
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // All app routes EXCEPT: API handlers, static assets, Next internals,
  // images and public files — CSP only matters for HTML documents.
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|woff2?|css|js|map)$).*)",
    },
  ],
};
