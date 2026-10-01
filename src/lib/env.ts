import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Environment validation — runs once at server bootstrap (src/instrumentation.ts).
// Fails fast on missing/weak secrets in production instead of breaking at
// the first login attempt deep inside a request.
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
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (e.g. file:./db/custom.db)"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required — generate with: openssl rand -hex 32"),
  ADMIN_SESSION_SECRET: z.string().min(1, "ADMIN_SESSION_SECRET is required — generate with: openssl rand -hex 32"),
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
  } else {
    const { SESSION_SECRET, ADMIN_SESSION_SECRET } = parsed.data;
    if (isWeakSecret(SESSION_SECRET)) {
      const msg = "SESSION_SECRET is weak (use `openssl rand -hex 32`) — sessions can be forged";
      (isProduction && !isBuildPhase ? errors : warnings).push(msg);
    }
    if (isWeakSecret(ADMIN_SESSION_SECRET)) {
      const msg = "ADMIN_SESSION_SECRET is weak (use `openssl rand -hex 32`) — admin sessions can be forged";
      (isProduction && !isBuildPhase ? errors : warnings).push(msg);
    }
  }

  // Round-4 audit: 2FA secret encryption MUST use a dedicated key in
  // production. Without it the key is derived from ADMIN_SESSION_SECRET, so
  // rotating that secret silently breaks every admin's 2FA (exactly the
  // coupling round 3 introduced the key to remove). Warn in dev, REFUSE TO
  // BOOT in production — a crash loop with a clear message beats a
  // locked-out admin fleet after the next secret rotation.
  if (process.env.TOTP_ENC_KEY && process.env.TOTP_ENC_KEY.length < 32) {
    const msg = "TOTP_ENC_KEY is set but shorter than 32 chars — generate one with `openssl rand -hex 32`";
    (isProduction && !isBuildPhase ? errors : warnings).push(msg);
  } else if (!process.env.TOTP_ENC_KEY) {
    const msg =
      "TOTP_ENC_KEY is not set — 2FA secrets would be encrypted with a key derived from ADMIN_SESSION_SECRET, so rotating that secret breaks every admin's 2FA. Generate a dedicated key: openssl rand -hex 32";
    (isProduction && !isBuildPhase ? errors : warnings).push(msg);
  }

  // Round-4 audit: with direct (no-proxy) exposure a client can forge a
  // single-entry x-forwarded-for and rotate fresh rate-limit buckets
  // (verified empirically — see README → Client IP & proxy configuration).
  // Nudge operators onto a proxy at boot.
  if (isProduction && !isBuildPhase && !process.env.TRUST_PROXY) {
    warnings.push(
      "TRUST_PROXY is not set (direct exposure) — clients can forge x-forwarded-for and rotate rate-limit buckets. Put the server behind Cloudflare/nginx and set TRUST_PROXY=cf or TRUST_PROXY=1 (see README → Client IP & proxy configuration)"
    );
  }

  // Advisory (round 3): SITE_URL semantics. NEXT_PUBLIC_* is inlined at BUILD
  // time — a runtime-only value is invisible to built server code.
  if (isProduction && !isBuildPhase) {
    const site = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
    if (!site) {
      warnings.push("Neither SITE_URL nor NEXT_PUBLIC_SITE_URL is set — emailed links (reset, verification, order tracking) will point at localhost");
    } else if (/^https?:\/\/localhost/i.test(site.replace(/\/+$/, ""))) {
      warnings.push(`Site URL is localhost (${site}) in production — emailed links will be unusable outside the server`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
