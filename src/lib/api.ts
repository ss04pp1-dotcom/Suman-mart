import { NextResponse } from "next/server";

// ── Response helpers ───────────────────────────────────────────
//
// All JSON responses carry Cache-Control: no-store. These APIs are
// user-context aware (session cookies decide the payload), so a browser
// heuristic cache must never replay one user's/anonymous response for
// another — e.g. the admin-null copy fetched by /admin/login before signing
// in must not be replayed on /admin/security afterwards (observed live in
// round-3 E2E).

export function ok<T>(data: T, init?: ResponseInit) {
  const res = NextResponse.json({ success: true, data }, init);
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  const res = NextResponse.json({ success: false, error: message, ...extra }, { status });
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export function pageParams(url: URL, defaultLimit = 12) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/**
 * CSRF defense for cookie-authenticated mutations: require same-origin.
 *
 * State-changing requests (POST/PUT/PATCH/DELETE):
 *  • Origin present        → must match the request host
 *  • Origin absent         → rejected in production (real browsers always send
 *                            Origin on cross-site mutations; its absence means
 *                            a non-browser client is forging cookie auth)
 *                            but allowed in development for curl/script testing.
 * Idempotent GET/HEAD/OPTIONS requests don't need the check.
 */
export function sameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const origin = req.headers.get("origin");

  if (!origin) {
    return !isMutation || process.env.NODE_ENV !== "production";
  }
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function parseBody<T>(raw: unknown): T {
  return raw as T;
}

// ── Analytics range handling ─────────────────────────────────────

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
  key: RangeKey;
}

export function resolveRange(url: URL): DateRange {
  const key = (url.searchParams.get("range") ?? "30d") as RangeKey;
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (key) {
    case "today":
      return { from: startOfToday, to: end, key };
    case "yesterday": {
      const from = new Date(startOfToday);
      from.setDate(from.getDate() - 1);
      const to = new Date(startOfToday);
      to.setMilliseconds(-1);
      return { from, to, key };
    }
    case "7d": {
      const from = new Date(startOfToday);
      from.setDate(from.getDate() - 6);
      return { from, to: end, key };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: end, key };
    }
    case "custom": {
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      const from = fromParam ? new Date(fromParam) : new Date(startOfToday.getTime() - 29 * 86400_000);
      const to = toParam ? new Date(toParam) : end;
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        const f = new Date(startOfToday.getTime() - 29 * 86400_000);
        return { from: f, to: end, key: "30d" };
      }
      to.setHours(23, 59, 59, 999);
      from.setHours(0, 0, 0, 0);
      return { from, to, key };
    }
    default: {
      const from = new Date(startOfToday);
      from.setDate(from.getDate() - 29);
      return { from, to: end, key: "30d" };
    }
  }
}

export function dayBuckets(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
