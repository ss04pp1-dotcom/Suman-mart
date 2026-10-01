// Suman Mart / ShopNest — public REST API (Cloudflare Workers + Hono).
//
// Target architecture (see docs/FEATURE-INVENTORY.md §8):
//   apps/storefront  → customer Next.js app      (shop.example.com)
//   apps/admin       → admin Next.js app          (admin.example.com)
//   apps/api  (this) → versioned REST API         (api.example.com)
//
// This service hosts the PUBLIC read surface first (strangler migration —
// nothing in the storefront is removed until its endpoint is verified here).
// Write-paths (auth, checkout, tracking ingestion, admin CRUD) are ported in
// later phases; until then they continue to run on the storefront service.

import { Hono } from "hono";
import type { Env } from "./env";
import { errBody } from "./lib/respond";
import { API_VERSION } from "@suman-mart/shared";
import { health } from "./routes/health";
import { products } from "./routes/products";
import { categories } from "./routes/categories";
import { settingsApi } from "./routes/settings";
import { ordersApi } from "./routes/orders";
import { media } from "./routes/media";

const app = new Hono<{ Bindings: Env }>();

// ── CORS ────────────────────────────────────────────────────────────
// Public read-only API with no credentials: "*" echoes any requesting
// origin. Set ALLOWED_ORIGINS="https://shop.example.com,https://admin.example.com"
// to lock it down (required once authenticated routes land here).

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin) {
    const allowed = (c.env.ALLOWED_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes("*") || allowed.includes(origin)) {
      c.header("Access-Control-Allow-Origin", allowed.includes("*") ? "*" : origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "600");
    }
  }
  await next();
});

// Preflight for every route.
app.options("*", (c) => c.body(null, 204));

// ── Baseline headers on every response ──────────────────────────────

app.use("*", async (c, next) => {
  c.header("X-API-Version", API_VERSION);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  await next();
  if (!c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

// ── Operational ─────────────────────────────────────────────────────

app.route("/health", health);

// API index — self-documenting entry point.
app.get("/", (c) =>
  c.json(
    {
      name: "Suman Mart API",
      version: API_VERSION,
      endpoints: {
        health: "GET /health",
        products: "GET /v1/products?q=&category=&tag=&minPrice=&maxPrice=&availability=&featured=&sort=&page=&limit=",
        product: "GET /v1/products/:slug",
        categories: "GET /v1/categories",
        publicSettings: "GET /v1/settings/public",
        trackOrder: "POST /v1/orders/track { orderNumber, phone }",
        media: "GET /v1/media/:key",
      },
      docs: "docs/API.md",
    },
    200,
    { "Cache-Control": "no-store" }
  )
);

// ── Versioned surface ───────────────────────────────────────────────

const v1 = new Hono<{ Bindings: Env }>();
v1.route("/products", products);
v1.route("/categories", categories);
v1.route("/settings", settingsApi);
v1.route("/orders", ordersApi);
v1.route("/media", media);
app.route(`/${API_VERSION}`, v1);

// ── Errors ──────────────────────────────────────────────────────────

app.notFound((c) => c.json(errBody("Route not found", "NOT_FOUND"), 404));

app.onError((err, c) => {
  // Structured server-side log — never leak stack traces to clients.
  console.error(
    JSON.stringify({
      level: "error",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message: err instanceof Error ? err.message : String(err),
    })
  );
  return c.json(errBody("Internal server error", "INTERNAL"), 500);
});

export default app;
