// Rate limiting — fixed windows persisted in the shared D1 database.
//
// Ported 1:1 from the monolith's dedicated-limiter design (round-3 audit):
// one atomic
//   INSERT (key,1,now) ON CONFLICT(key) DO UPDATE SET
//     count       = window expired ? 1 : count + 1,
//     windowStart = window expired ? now : windowStart
//   RETURNING count, windowStart
// so concurrent requests can never under-count. Fixed-window semantics (a
// burst may straddle a boundary and reach ~2x the limit) — an accepted,
// documented trade-off, unchanged from the monolith.
//
// Differences from the Node deployment, by necessity of the platform:
//   • Buckets live in the SAME D1 database as the store data (the separate
//     ratelimit.db file existed to avoid SQLite single-writer lock contention
//     with checkout; D1 serialises writes service-side, so the original
//     contention model does not apply).
//   • Failure mode preserved: if the D1 write fails, the limiter degrades to a
//     per-ISOLATE in-memory fixed window — weaker (not shared across
//     machines, lost when the isolate recycles) but never fully open.
//
// Swap the whole layer for Cloudflare's Rate Limiting binding or KV at higher
// traffic by keeping the signatures.

import type { Env } from "../env";
import { runtimeEnv } from "@/lib/config";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const CLEANUP_ODDS = 0.01; // opportunistic purge of stale buckets

// ── In-memory fallback (used only while the D1 write fails) ──────────

interface MemBucket {
  count: number;
  windowStart: number;
}

const globalForMem = globalThis as unknown as {
  rlMemBuckets: Map<string, MemBucket> | undefined;
  rlMemWarnedAt: number;
};

const memBuckets = (globalForMem.rlMemBuckets ??= new Map<string, MemBucket>());

function memRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    memBuckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)),
    };
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

function warnDegraded(error: unknown) {
  const now = Date.now();
  if (now - (globalForMem.rlMemWarnedAt ?? 0) > 60_000) {
    globalForMem.rlMemWarnedAt = now;
    console.error("[rate-limit] D1 unavailable — degrading to per-isolate in-memory limits:", error);
  }
}

// The env is bound per isolate by the env bridge (src/index.ts) before any
// route runs; rateLimit() is only called inside request handling.
function d1(): D1Database {
  const env = (globalThis as unknown as { __apiEnv?: Env }).__apiEnv;
  if (!env?.DB) throw new Error("rateLimit() used before the env bridge ran");
  return env.DB;
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const cutoff = now - windowMs;

  try {
    const db = d1();
    // windowStart is stored as epoch milliseconds (INTEGER), matching Prisma's
    // SQLite DateTime representation used by every other table.
    const row = await db
      .prepare(
        `INSERT INTO "RateLimitEntry" ("key", "count", "windowStart")
         VALUES (?1, 1, ?2)
         ON CONFLICT("key") DO UPDATE SET
           "count" = CASE WHEN "windowStart" <= ?3 THEN 1 ELSE "RateLimitEntry"."count" + 1 END,
           "windowStart" = CASE WHEN "windowStart" <= ?3 THEN ?2 ELSE "RateLimitEntry"."windowStart" END
         RETURNING "count", "windowStart"`
      )
      .bind(key, now, cutoff)
      .first<{ count: number; windowStart: number }>();

    const count = row?.count ?? 1;
    const windowStart = typeof row?.windowStart === "number" ? row.windowStart : now;

    if (Math.random() < CLEANUP_ODDS) {
      db.prepare(`DELETE FROM "RateLimitEntry" WHERE "windowStart" < ?1`)
        .bind(now - 3_600_000)
        .run()
        .catch(() => undefined);
    }

    if (count > limit) {
      const elapsed = now - windowStart;
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
      };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 };
  } catch (e) {
    // Fail DEGRADED (per-isolate memory), never fail OPEN.
    warnDegraded(e);
    return memRateLimit(key, limit, windowMs);
  }
}

/** Reset a bucket (e.g. after a successful login clears the failure counter). */
export async function resetRateLimit(key: string): Promise<void> {
  memBuckets.delete(key);
  try {
    await d1()
      .prepare(`DELETE FROM "RateLimitEntry" WHERE "key" = ?1`)
      .bind(key)
      .run()
      .catch(() => undefined);
  } catch {
    // memory copy already cleared — nothing else to do
  }
}

// ── Client IP resolution ─────────────────────────────────────────────
//
// Trust model — ported from the monolith, adapted for Workers:
//
//   • Deployed on Cloudflare (default when TRUST_PROXY=cf): cf-connecting-ip
//     is authoritative (the edge overwrites any client-supplied copy).
//   • TRUST_PROXY=1 (custom proxy in front): x-real-ip → LAST
//     x-forwarded-for entry (the one OUR proxy appended).
//   • Unset: single-entry x-forwarded-for only (proxy-injected), otherwise
//     "unknown" — identical logic to the Node server.

const IP_RE = /^[0-9a-fA-F.:]+$/;

function validIp(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && IP_RE.test(v) ? v : null;
}

export function clientIp(req: Request): string {
  const trust = (runtimeEnv().TRUST_PROXY ?? "").trim().toLowerCase();

  if (trust === "cf" || trust === "cloudflare") {
    const cf = validIp(req.headers.get("cf-connecting-ip"));
    if (cf) return cf;
    // Request bypassed Cloudflare — fall through to generic proxy resolution.
  }

  if (trust === "1" || trust === "true" || trust === "proxy" || trust === "cf" || trust === "cloudflare") {
    const real = validIp(req.headers.get("x-real-ip"));
    if (real) return real;
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) {
      const entries = fwd.split(",").map((s) => s.trim()).filter(Boolean);
      const last = validIp(entries[entries.length - 1]);
      if (last) return last;
    }
    return "proxy-unknown";
  }

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const entries = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (entries.length === 1) {
      const single = validIp(entries[0]);
      if (single) return single;
    }
  }
  return "unknown";
}

// ── IP-keyed limiting ────────────────────────────────────────────────
//
// When the client IP cannot be resolved ("unknown"), every anonymous client
// would share ONE bucket — a single attacker would block everyone else. The
// shared bucket gets a proportionally scaled limit instead (round-3 finding).

const UNKNOWN_BUCKET_SCALE = 20;

export async function ipRateLimit(prefix: string, limit: number, windowMs: number, req: Request): Promise<RateLimitResult> {
  const ip = clientIp(req);
  if (ip === "unknown" || ip === "proxy-unknown") {
    return rateLimit(`${prefix}:unknown`, limit * UNKNOWN_BUCKET_SCALE, windowMs);
  }
  return rateLimit(`${prefix}:${ip}`, limit, windowMs);
}
