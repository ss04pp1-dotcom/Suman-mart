// ─────────────────────────────────────────────────────────────────────────
// Canonical public site URL.
//
// Used wherever the server builds links that leave the site: password-reset
// and verification emails, order confirmation mails, webhooks, sitemap.
// A relative link in an email is unclickable — every outbound link MUST go
// through siteUrl().
//
// Build-time vs runtime (round-3 audit finding): Next.js inlines
// NEXT_PUBLIC_* variables into the bundle at BUILD time — including in
// server code. A value that is only set at RUNTIME is therefore invisible
// to already-built code (links silently degrade to localhost). Precedence:
//   1. SITE_URL            — plain (non-public) env var, read at RUNTIME;
//                            works for post-build configuration
//   2. NEXT_PUBLIC_SITE_URL — inlined at build time; set it during `next build`
// In practice: either set NEXT_PUBLIC_SITE_URL when you build, or set
// SITE_URL on the server at runtime — or both (SITE_URL wins).
// ─────────────────────────────────────────────────────────────────────────

let warned: "missing" | "localhost" | null = null;

function warnOnce(kind: "missing" | "localhost") {
  if (warned === kind) return;
  warned = kind;
  if (process.env.NODE_ENV !== "production") return;
  if (kind === "missing") {
    console.warn(
      "[site] Neither SITE_URL nor NEXT_PUBLIC_SITE_URL is set — emailed links (password reset, email verification, order tracking) will be unusable. Set SITE_URL on the server (runtime) or NEXT_PUBLIC_SITE_URL at build time."
    );
  } else {
    console.warn(
      "[site] The site URL resolves to localhost in production — emailed links will point at localhost. Set SITE_URL (runtime) or NEXT_PUBLIC_SITE_URL (build time) to your public origin, e.g. https://shopnest.com.bd"
    );
  }
}

export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  if (raw) {
    const clean = raw.replace(/\/+$/, "");
    if (/^https?:\/\/localhost/i.test(clean)) warnOnce("localhost");
    return clean;
  }
  warnOnce("missing");
  return "http://localhost:3000";
}

/** Build an absolute URL for a site path (leading slash required). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
