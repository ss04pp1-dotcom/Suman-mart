// Runtime environment access for app code.
//
// WHY an accessor instead of bare `process.env.X`: the Vitest (Vite SSR)
// pipeline statically rewrites bare `process.env` member accesses and serves
// them from the test-runner's process — bypassing workerd's environment
// entirely (verified empirically: bindings visible via globalThis.process.env
// were invisible through bare `process.env` in the same module). Indirect
// access through globalThis cannot be statically rewritten, so it works in
// BOTH pipelines:
//   • tests (Vite SSR)  → globalThis.__snApiEnv (maintained by bridgeEnv)
//   • wrangler deploy   → the same object (bridgeEnv also mirrors values
//                         into workerd's real process.env for good measure)
//
// bridgeEnv (src/index.ts) runs as the first middleware on every request and
// populates __snApiEnv from the worker bindings before any route code reads it.

export function runtimeEnv(): Record<string, string | undefined> {
  const g = globalThis as unknown as {
    __snApiEnv?: Record<string, string | undefined>;
    process?: { env?: Record<string, string | undefined> };
  };
  return g.__snApiEnv ?? g.process?.env ?? {};
}

/** Read an environment value with a fallback ("" when unset). */
export function envValue(key: string, fallback = ""): string {
  const value = runtimeEnv()[key];
  return value === undefined ? fallback : value;
}

/**
 * Date literal for RAW SQL against datetime columns.
 *
 * The Prisma D1 adapter stores/binds DateTime as ISO-8601 TEXT with an
 * explicit +00:00 offset (see @prisma/adapter-d1 mapArg). Raw SQL that
 * filters or writes datetime columns MUST use the SAME representation —
 * binding epoch millis against TEXT-stored dates compares INTEGER vs TEXT
 * and silently matches nothing (verified empirically).
 * (The RateLimitEntry table is written+read exclusively by raw SQL and keeps
 * epoch-millis by design — see lib/rate-limit.ts.)
 */
export function sqlDate(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  return d.toISOString().replace("Z", "+00:00");
}
