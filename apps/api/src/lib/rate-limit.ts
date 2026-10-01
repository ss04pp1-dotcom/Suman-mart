// Rate limiting for the Workers API — D1-backed fixed windows.
//
// Ported from the monolith's dedicated-limiter design (round-3 audit): one
// atomic INSERT .. ON CONFLICT UPDATE .. RETURNING statement per check, so two
// concurrent requests can never both read the same count (the classic
// read-check-write race). On D1 everything shares one database — acceptable
// here because D1 has no single-writer file lock, and the checkout write-path
// does not run on this service yet (documented in docs/FEATURE-INVENTORY.md).
//
// Fixed-window semantics (documented trade-off, unchanged from the monolith):
// a client may see up to ~2x the limit across a window boundary.

import type { Env } from "../env";

export interface RateLimitResult {
  ok: boolean;
  /** Attempts counted in the current window, including this one. */
  count: number;
}

/**
 * Count one attempt against `name:identifier` in a fixed window.
 * The attempt is recorded even when the limit is exceeded (same as the
 * monolith) — rejected calls are still observable in the bucket.
 */
export async function rateLimit(
  env: Env,
  name: string,
  identifier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `${name}:${identifier}:${bucket}`;
  const stmt = env.DB.prepare(
    `INSERT INTO RateLimitEntry ("key", "count", "windowStart")
     VALUES (?, 1, ?)
     ON CONFLICT("key") DO UPDATE SET "count" = "count" + 1
     RETURNING "count" AS count`
  );
  const row = await stmt.bind(key, Date.now()).first<{ count: number }>();
  const count = row?.count ?? 1;
  return { ok: count <= limit, count };
}

/** Client IP for rate-limit keys. On Workers, CF-Connecting-IP is set by the edge. */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Opportunistic purge of buckets older than 2 window-ago — never blocks the request. */
export async function purgeOldBuckets(env: Env, windowMs: number): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM RateLimitEntry WHERE "windowStart" < ?`).bind(Date.now() - 2 * windowMs).run();
  } catch {
    // Purge is best-effort; the table is tiny and keyed by bucket.
  }
}
