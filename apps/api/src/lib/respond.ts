// Response helpers — the API's public envelope.
//
// Shape-compatible with the monolith's ok()/fail() (apps/storefront
// src/lib/api.ts) so every existing client keeps parsing the same JSON:
//   success: { success: true, data }
//   error:   { success: false, error, code? }
//
// All API responses are Cache-Control: no-store — payloads are context-aware
// and a shared/CDN cache must never replay them.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function okBody<T>(data: T) {
  return { success: true as const, data };
}

export function errBody(error: string, code?: string) {
  return code ? { success: false as const, error, code } : { success: false as const, error };
}

/** 2xx JSON with the success envelope. */
export function ok<T>(c: Context, data: T, status: 200 | 201 = 200) {
  c.header("Cache-Control", "no-store");
  return c.json(okBody(data), status);
}

/**
 * Error JSON with a stable envelope.
 * `extra` mirrors the monolith's fail(): a machine-readable CODE string, or an
 * arbitrary object merged into the body (e.g. { allowedStatuses: [...] }).
 */
export function fail(c: Context, error: string, status: ContentfulStatusCode | number, extra?: string | Record<string, unknown>) {
  c.header("Cache-Control", "no-store");
  const body =
    typeof extra === "string"
      ? errBody(error, extra)
      : extra
        ? { success: false as const, error, ...extra }
        : errBody(error);
  return c.json(body, status as ContentfulStatusCode);
}

// ── Pagination ──────────────────────────────────────────────────────

export interface PageParams {
  page: number;
  limit: number;
  offset: number;
  /** Prisma-style aliases used by the ported route bodies. */
  skip: number;
  take: number;
}

export function pageParams(url: URL, defaultLimit = 12): PageParams {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset, skip: offset, take: limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
