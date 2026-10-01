// GET /v1/media/* — serve product/banner/uploaded media from Cloudflare R2.
//
// The R2 bucket is the platform's media store in the target architecture
// (wrangler r2 bucket create suman-mart-media; see README → Deployment).
// Content is immutable per key: uploads generate unique keys, so responses
// are cacheable for a year. This is the ONLY route that opts out of the
// global no-store policy.

import { Hono } from "hono";
import type { Env } from "../env";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml", // never uploaded by the admin app (SVG banned), listed for completeness
  avif: "image/avif",
  ico: "image/x-icon",
};

export const media = new Hono<{ Bindings: Env }>();

media.get("/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/v1\/media\//, ""));
  if (!key || key.includes("..")) {
    return c.json({ success: false, error: "Invalid media key", code: "VALIDATION_ERROR" }, 422);
  }

  const object = await c.env.MEDIA.get(key);
  if (!object) {
    return c.json({ success: false, error: "Media not found", code: "NOT_FOUND" }, 404);
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", object.httpMetadata?.contentType ?? CONTENT_TYPES[ext] ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.etag) headers.set("ETag", object.etag);
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { status: 200, headers });
});
