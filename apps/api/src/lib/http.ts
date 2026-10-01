// HTTP plumbing shared by every ported route handler.
import { runtimeEnv } from "@/lib/config";
//
// The storefront's route handlers returned `ok()` / `fail()` JSON and let
// NextResponse carry cookies. On Hono the same envelopes exist in
// ./respond.ts; this module adds the pieces that replace Next.js APIs:
//
//   • HttpError  — thrown by guards (requireCustomer / requireAdmin / …) and
//     mapped to the exact same JSON error envelope by the app-level onError
//     handler in src/index.ts. This keeps the ported route bodies faithful to
//     the originals (which returned `fail(...)` responses directly).
//   • sameOrigin / csrfCheck — the monolith's cookie-CSRF defence, adapted:
//     behind the storefront/admin runtime proxies the browser Origin is the
//     PROXY's origin, and the proxy forwards the original Host in
//     x-forwarded-host. Direct browser calls (allowed origins list) are also
//     accepted. Absent Origin is allowed outside production for curl/tests,
//     exactly like the original.

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = { success: false, error: message, ...(extra ?? {}) };
  }
}

/** Fail with the standard envelope (thrown and caught by the error mapper). */
export function httpFail(status: number, message: string, extra?: Record<string, unknown>): never {
  throw new HttpError(status, message, extra);
}

// ── CSRF: cookie-authenticated mutations must be same-origin ──────────
//
// Accepted when ANY of:
//   • Origin matches x-forwarded-host (the storefront/admin proxy path — the
//     proxy sets x-forwarded-host to the original Host)
//   • Origin's host matches the request's own host header
//   • Origin is explicitly allowed (ALLOWED_ORIGINS — first-party apps in
//     production)
//   • Origin absent: allowed in development/test (curl, scripts, tests);
//     rejected in production (real browsers always send Origin on
//     cross-site mutations).

function originHostMatches(origin: string, host: string | null): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function sameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (!isMutation) return true;

  const origin = req.headers.get("origin");
  if (!origin) {
    return runtimeEnv().NODE_ENV !== "production";
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  if (originHostMatches(origin, host)) return true;

  const allowed = (runtimeEnv().ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (allowed.includes("*") || allowed.includes(origin.replace(/\/+$/, ""))) return true;

  return false;
}

// ── Request body / query helpers (mirror the original ergonomics) ─────

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
