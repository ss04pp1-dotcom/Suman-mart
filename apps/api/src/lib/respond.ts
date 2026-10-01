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

/** Error JSON with a stable envelope + machine-readable code. */
export function fail(c: Context, error: string, status: ContentfulStatusCode, code?: string) {
  c.header("Cache-Control", "no-store");
  return c.json(errBody(error, code), status);
}

// ── Pagination ──────────────────────────────────────────────────────

export interface PageParams {
  page: number;
  limit: number;
  offset: number;
}

export function pageParams(url: URL, defaultLimit = 12): PageParams {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
