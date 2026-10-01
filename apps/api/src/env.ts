// Cloudflare Workers bindings for the Suman Mart API.
// Kept in sync with apps/api/wrangler.jsonc.

export interface Env {
  /** Main store database (Cloudflare D1). */
  DB: D1Database;
  /** Product / banner / uploaded media (Cloudflare R2). */
  MEDIA: R2Bucket;
  /**
   * Comma-separated list of origins allowed to call this API from a browser
   * ("*" echoes any origin — acceptable for a public read-only API with no
   * credentials; restrict for the future authenticated surface).
   */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}
