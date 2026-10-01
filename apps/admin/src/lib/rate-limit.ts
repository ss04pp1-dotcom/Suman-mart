import { rateLimitDb } from "@/lib/rate-limit-db";

// ─────────────────────────────────────────────────────────────────────────
// Rate limiting — fixed windows persisted in a DEDICATED SQLite database
// (db/ratelimit.db — see src/lib/rate-limit-db.ts).
//
// Buckets live in a separate file from the store database so that:
//  • limiter writes never contend with the checkout transaction for the
//    main database's write lock (round-3 audit finding)
//  • limits still survive server restarts
//  • instances sharing the volume share the buckets
//
// Each check is ONE atomic statement:
//   INSERT (key, 1, now) ON CONFLICT(key) DO UPDATE SET
//     count       = window expired ? 1 : count + 1,
//     windowStart = window expired ? now : windowStart
// so concurrent requests can never under-count. Window semantics are fixed
// (not sliding): a burst may straddle a boundary and reach ~2× the limit in
// the worst case — an accepted trade-off for cross-instance correctness.
//
// Failure mode (round-3 audit finding): the limiter used to fail OPEN —
// exactly when the system is under stress (DB busy/errored) the protection
// switched off. It now degrades to a per-process IN-MEMORY fixed window:
// weaker (not shared, lost on restart) but never fully open.
//
// Swap the whole layer for Redis/KV at high traffic by keeping the signature.
// ─────────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const CLEANUP_ODDS = 0.01; // opportunistic purge of stale buckets

// ── In-memory fallback (used only while the rate-limit DB is unavailable) ──

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
    console.error(
      "[rate-limit] bucket database unavailable — degrading to per-process in-memory limits:",
      error
    );
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  try {
    const db = await rateLimitDb();
    const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitEntry" ("key", "count", "windowStart")
      VALUES (${key}, 1, ${now})
      ON CONFLICT("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitEntry"."windowStart" <= ${cutoff} THEN 1 ELSE "RateLimitEntry"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitEntry"."windowStart" <= ${cutoff} THEN ${now} ELSE "RateLimitEntry"."windowStart" END
      RETURNING "count", "windowStart"
    `;
    const row = rows[0];
    const count = row?.count ?? 1;
    const windowStart = row?.windowStart instanceof Date ? row.windowStart : now;

    if (Math.random() < CLEANUP_ODDS) {
      // Buckets idle for an hour are dead weight — drop them occasionally.
      db.rateLimitEntry
        .deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 3_600_000) } } })
        .catch(() => undefined);
    }

    if (count > limit) {
      const elapsed = now.getTime() - windowStart.getTime();
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
      };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 };
  } catch (e) {
    // Fail DEGRADED (per-process memory), never fail OPEN.
    warnDegraded(e);
    return memRateLimit(key, limit, windowMs);
  }
}

/** Reset a bucket (e.g. after a successful login clears the failure counter). */
export async function resetRateLimit(key: string): Promise<void> {
  memBuckets.delete(key);
  try {
    const db = await rateLimitDb();
    await db.rateLimitEntry.deleteMany({ where: { key } }).catch(() => undefined);
  } catch {
    // memory copy already cleared — nothing else to do
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Client IP resolution
//
// Trust model — a spoofed IP header must never unlock a private bucket
// (behaviour VERIFIED EMPIRICALLY against Next 16.1.1 standalone):
//
//  • TRUST_PROXY=cf (behind Cloudflare):
//      cf-connecting-ip is authoritative (Cloudflare overwrites any
//      client-supplied copy), falling back to x-real-ip / last XFF entry
//      for requests that bypass Cloudflare.
//  • TRUST_PROXY=1 (behind your OWN nginx/Caddy reverse proxy):
//      x-real-ip → LAST x-forwarded-for entry. The proxy appends the real
//      client IP, so the last entry is ours; earlier entries are
//      client-controlled. cf-connecting-ip is deliberately NOT consulted —
//      without Cloudflare in front, any client can forge it.
//  • TRUST_PROXY unset (direct exposure):
//      Next.js's Node server injects the socket remote address into
//      x-forwarded-for when (and only when) the client didn't send one —
//      so a single-entry XFF is the real peer address for honest clients.
//      A malicious client CAN send a forged single-entry XFF and rotate
//      fresh buckets; per-identity limits (email, session) are the
//      rotation-proof backstop. Hardened deployments should sit behind a
//      proxy with TRUST_PROXY set (see README → Deployment).
//      Multi-entry XFF without a proxy = client-supplied junk → "unknown".
// ─────────────────────────────────────────────────────────────────────────

const IP_RE = /^[0-9a-fA-F.:]+$/;

function validIp(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && IP_RE.test(v) ? v : null;
}

export function clientIp(req: Request): string {
  const trust = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();

  if (trust === "cf" || trust === "cloudflare") {
    const cf = validIp(req.headers.get("cf-connecting-ip"));
    if (cf) return cf;
    // Request bypassed Cloudflare (direct origin hit) — fall through to the
    // generic reverse-proxy resolution below.
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
      if (single) return single; // injected by Next from the socket
    }
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────
// IP-keyed limiting
//
// When the client IP cannot be resolved ("unknown"), every anonymous client
// would share ONE bucket — a single attacker's traffic would block everyone
// else on the site (round-3 audit finding). The shared bucket therefore gets
// a proportionally scaled limit instead: far above any single legitimate
// client's needs, while still capping total anonymous abuse.
// ─────────────────────────────────────────────────────────────────────────

const UNKNOWN_BUCKET_SCALE = 20;

export async function ipRateLimit(prefix: string, limit: number, windowMs: number, req: Request): Promise<RateLimitResult> {
  const ip = clientIp(req);
  if (ip === "unknown" || ip === "proxy-unknown") {
    return rateLimit(`${prefix}:unknown`, limit * UNKNOWN_BUCKET_SCALE, windowMs);
  }
  return rateLimit(`${prefix}:${ip}`, limit, windowMs);
}
