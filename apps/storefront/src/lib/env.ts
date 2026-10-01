import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Environment validation — runs once at server bootstrap (src/instrumentation.ts).
// Fails fast on missing/weak secrets in production instead of breaking at the
// first request.
//
// Phase-9 note: the storefront is a pure UI + proxy tier. ALL business logic,
// database access, rate limiting and mail delivery live in the Workers API
// (apps/api). This app only needs the session secret (edge middleware
// pre-verifies customer JWTs — the API re-verifies every request against the
// database) and the proxy target.
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_SECRETS = new Set([
  "change-me",
  "change-me-customer-session-secret",
  "change-me-admin-session-secret",
  "secret",
  "changeme",
]);

function isWeakSecret(value: string): boolean {
  return FORBIDDEN_SECRETS.has(value.toLowerCase().trim()) || value.length < 32;
}

const envSchema = z.object({
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required — generate with: openssl rand -hex 32"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface EnvCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Validate the process environment. Never throws — returns a report. */
export function checkEnv(): EnvCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  // `next build` collects page data with NODE_ENV=production — don't fail the
  // build for runtime-only secrets; the standalone server validates on boot.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      (isProduction && !isBuildPhase ? errors : warnings).push(`${issue.path.join(".")}: ${issue.message}`);
    }
  } else if (isWeakSecret(parsed.data.SESSION_SECRET)) {
    const msg = "SESSION_SECRET is weak (use `openssl rand -hex 32`) — sessions can be forged";
    (isProduction && !isBuildPhase ? errors : warnings).push(msg);
  }

  // The proxy target. Same value is read at request time by
  // lib/backend-proxy.ts — a wrong origin means every /api/* call 502s.
  const backend = process.env.BACKEND_ORIGIN;
  if (isProduction && !isBuildPhase && (!backend || /^https?:\/\/(localhost|127\.)/.test(backend))) {
    warnings.push(
      `BACKEND_ORIGIN is ${backend ?? "unset (defaults to http://localhost:8787)"} — in production it must point at the deployed Workers API (e.g. https://api.your-domain.com)`
    );
  }

  // SESSION_SECRET must be the SAME value the Workers API runs with: the
  // edge middleware only pre-verifies the JWT locally; the API re-verifies
  // every request server-side, so a mismatch surfaces as a login loop.
  if (isProduction && !isBuildPhase) {
    const site = process.env.NEXT_PUBLIC_SITE_URL || "";
    if (!site) {
      warnings.push("NEXT_PUBLIC_SITE_URL is not set — robots.txt and sitemap.xml will use a placeholder origin");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
