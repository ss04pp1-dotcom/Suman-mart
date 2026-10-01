import { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────
// Runtime proxy to the shared backend (Cloudflare Workers API).
//
// Why a route handler instead of next.config rewrites: rewrites are evaluated
// at BUILD time (baked into routes-manifest.json), so the destination could
// not be changed per environment without a rebuild. This proxy reads
// BACKEND_ORIGIN at REQUEST time — the admin deployment points at whatever
// backend serves the API that day.
//
// Phase 9: the backend is the Cloudflare Workers API (apps/api) — same-origin
// /api/admin/* paths map onto the versioned surface ${BACKEND_ORIGIN}/v1/*,
// and media paths map onto the R2-backed /v1/media route.
//
// Cookie/authentication headers are forwarded in both directions, and the
// original Origin + Host are passed through as x-forwarded-host so the
// backend's same-origin CSRF check keeps working behind the proxy.
// ─────────────────────────────────────────────────────────────────────────

export const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8787";

/** Headers that must reach the backend verbatim. */
const FORWARD_REQUEST_HEADERS = ["content-type", "cookie", "origin", "x-forwarded-for", "user-agent", "accept", "accept-language"];

/** Response headers worth copying (content-encoding/length must NOT be). */
const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "location", "retry-after"];

export async function proxyToBackend(req: NextRequest, prefix: string, path: string[]): Promise<Response> {
  void prefix; // same-origin prefix (e.g. "/api/admin") — the API is versioned
  const incoming = new URL(req.url);
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = `${BACKEND_ORIGIN}/v1/admin/${suffix}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The backend's sameOrigin() CSRF check compares Origin against
  // x-forwarded-host (falling back to host). Behind this proxy the browser's
  // Origin is the ADMIN origin, so it must learn the original host.
  const originalHost = req.headers.get("host");
  if (originalHost) headers.set("x-forwarded-host", originalHost);

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
 * Proxy a media path (/products/x.jpg, /uploads/x.png …) to the API's
 * R2-backed media route (/v1/media/<prefix>/<path>).
 */
export async function proxyMediaToBackend(prefix: string, path: string[]): Promise<Response> {
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/");
  const target = `${BACKEND_ORIGIN}/v1/media/${prefix}/${suffix}`;
  const res = await fetch(target, { method: "GET" });
  const outHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "etag"]) {
    const value = res.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
