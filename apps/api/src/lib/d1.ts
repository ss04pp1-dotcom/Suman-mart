// D1 row helpers.
//
// Prisma's SQLite mapping stores booleans as 0/1 integers and dates as
// ISO-8601 strings. The API's JSON contract (matching the monolith) uses real
// booleans, so rows are normalized through these tiny mappers before being
// serialized.

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "true";
}

export function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function toStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

export function parseJSON<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Builds `("a","b","c")` placeholders for IN clauses. */
export function inPlaceholders(n: number): string {
  return `(${Array.from({ length: n }, () => "?").join(",")})`;
}

/**
 * LIKE pattern for substring search. SQLite's LIKE is case-insensitive for
 * ASCII by default — the same behavior as Prisma's `contains` on SQLite.
 * `%` and `_` in user input are escaped so they match literally.
 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
