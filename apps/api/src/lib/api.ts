// Route-helper module for the ported API surface.
//
// The storefront's src/lib/api.ts mixed NextResponse helpers with pure
// utilities. On Hono the Next-specific pieces live in ./respond.ts (ok/fail/
// paginated on a Context) and ./http.ts (HttpError + CSRF); this module
// re-exports them under the paths the ported route files import, plus the
// pure analytics range helpers that were in the original file (ported
// verbatim below).

export { ok, fail, okBody, errBody, pageParams, paginated } from "./respond";
export type { PageParams } from "./respond";
export { sameOrigin, readJson, HttpError, httpFail } from "./http";
export { parseBody } from "./pure";

// ── Analytics range handling (ported verbatim) ────────────────────

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
