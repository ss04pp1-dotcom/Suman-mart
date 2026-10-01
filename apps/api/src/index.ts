// Suman Mart / ShopNest — REST API (Cloudflare Workers + Hono).
//
// Target architecture (see docs/FEATURE-INVENTORY.md §8):
//   apps/storefront  → customer Next.js app      (shop.example.com)
//   apps/admin       → admin Next.js app          (admin.example.com)
//   apps/api  (this) → versioned REST API         (api.example.com)
//
// Phase 8: the FULL surface (public catalog, customer auth/account, checkout,
// tracking ingestion, admin CRUD/analytics) runs here on D1 + R2. The
// storefront and admin apps are pure UI + runtime proxies pointed at /v1 —
// no business logic runs on Next.js anymore.

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
import { authApi } from "./routes/auth";
import { accountApi } from "./routes/account";
import { checkoutApi } from "./routes/checkout";
import { trackingApi } from "./routes/tracking";
import { reviewsApi } from "./routes/reviews";
import { storefrontApi } from "./routes/storefront";
import { adminAuthApi } from "./routes/admin/auth";
import { adminDashboardApi } from "./routes/admin/dashboard";
import { adminProductsApi } from "./routes/admin/products";
import { adminCategoriesApi, adminCouponsApi, adminBannersApi, adminReviewsApi } from "./routes/admin/catalog";
import { adminOrdersApi } from "./routes/admin/orders";
import { adminCustomersApi, adminTeamApi } from "./routes/admin/customers";
import { adminSuppliersApi } from "./routes/admin/suppliers";
import { adminAnalyticsApi } from "./routes/admin/analytics";
import { adminReportsApi } from "./routes/admin/reports";
import { adminSettingsApi, adminMaintenanceApi, adminNotificationsApi, adminUploadApi } from "./routes/admin/settings";
import { HttpError } from "./lib/http";
import { CheckoutError } from "./lib/checkout";
import { bindDb } from "./lib/db";

const app = new Hono<{ Bindings: Env }>();

// ── Env bridge ─────────────────────────────────────────────────────
// workerd's `process.env` (nodejs_compat) is NOT populated with bindings —
// vars/secrets arrive only on the `env` object. The ported business logic
// reads environment values through runtimeEnv() (src/lib/config.ts), which
// serves the __snApiEnv object maintained here. Idempotent + cheap.
// bindDb() records the D1 binding for the lazy Prisma client (lib/db.ts).

// ── Local D1 write serialization ────────────────────────────────────
// The LOCAL dev/test D1 (workerd's in-process SQLite) executes on a single
// connection: a query racing an open batch transaction deadlocks until the
// runtime's hang detector kills the request. Real Cloudflare D1 queues
// writes server-side and runs readers on WAL snapshots, so this is a
// local-runtime limitation only. Outside production we therefore wrap the
// D1 binding with a per-isolate serializer covering EVERY access path
// (raw prepare().run(), env.DB.batch, and Prisma through the adapter), which
// mirrors — locally — the write serialization real D1 performs natively.

const d1WrapCache = new WeakMap<object, D1Database>();

function serializeD1(db: D1Database): D1Database {
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run as Promise<T>;
  };
  const STMT_METHODS = new Set(["run", "all", "first", "get", "raw"]);

  // Statement proxy: executing methods are enqueued; .bind() returns a NEW
  // statement that must be wrapped again (an unwrapped escape would race).
  const proxyStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(s, p) {
        const value = (s as unknown as Record<string, unknown>)[p as string];
        if (typeof value !== "function") return value;
        if (p === "bind") {
          return (...bindArgs: unknown[]) =>
            proxyStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(s, bindArgs));
        }
        if (STMT_METHODS.has(p as string)) {
          return (...callArgs: unknown[]) => enqueue(() => (value as (...a: unknown[]) => Promise<unknown>).apply(s, callArgs));
        }
        return (value as (...a: unknown[]) => unknown).bind(s);
      },
    });

  return new Proxy(db, {
    get(target, prop) {
      const value = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof value !== "function") return value;
      if (prop === "prepare") {
        return (...args: Parameters<D1Database["prepare"]>) => proxyStatement(target.prepare(...args));
      }
      if (prop === "batch" || prop === "exec") {
        return (...callArgs: unknown[]) => enqueue(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, callArgs));
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  }) as D1Database;
}

const bridgedEnvs = new WeakSet<object>();
export function bridgeEnv(env: Env) {
  if (bridgedEnvs.has(env)) return;
  bridgedEnvs.add(env);

  if (env.ENVIRONMENT !== "production") {
    const rawDb = (env as { DB: D1Database }).DB;
    let wrapped = d1WrapCache.get(rawDb as unknown as object);
    if (!wrapped) {
      wrapped = serializeD1(rawDb);
      d1WrapCache.set(rawDb as unknown as object, wrapped);
    }
    (env as { DB: D1Database }).DB = wrapped;
  }

  bindDb(env);

  const merged: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    const value = (env as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") merged[key] = value;
  }
  merged.NODE_ENV = env.ENVIRONMENT === "production" ? "production" : "development";

  // The merged view lives on globalThis for BOTH access paths:
  //  • __snApiEnv — what runtimeEnv() (src/lib/config.ts) serves to app code
  //  • workerd's own process.env — mirrored for the production bundle, where
  //    bare process.env accesses are NOT rewritten by any bundler
  const g = globalThis as unknown as {
    __snApiEnv?: Record<string, string>;
    process?: { env: Record<string, string | undefined> };
  };
  g.__snApiEnv = { ...merged, ...(g.__snApiEnv ?? {}) };
  if (g.process?.env) {
    for (const [key, value] of Object.entries(g.__snApiEnv)) {
      if (g.process.env[key] === undefined) g.process.env[key] = value;
    }
  }
}

// ── CORS ────────────────────────────────────────────────────────────
// The storefront/admin talk to this API through their same-origin runtime
// proxies, so browsers never make cross-origin API calls in the normal flow.
// Direct browser calls are allowed for the listed origins. Lock
// ALLOWED_ORIGINS down to your storefront/admin domains in production
// (credentials flow through the proxies, so "*" must never be combined with
// credentialed cross-origin access).

app.use("*", async (c, next) => {
  bridgeEnv(c.env);
  const origin = c.req.header("Origin");
  if (origin) {
    const allowed = (c.env.ALLOWED_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes("*") || allowed.includes(origin)) {
      const locked = !allowed.includes("*");
      c.header("Access-Control-Allow-Origin", locked ? origin : "*");
      c.header("Vary", "Origin");
      if (locked) c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
        auth: "POST /v1/auth/login | register | logout | forgot | reset | verify-email — GET /v1/auth/me",
        account: "GET/PUT /v1/account/profile — GET/POST/PUT/DELETE /v1/account/addresses — GET /v1/account/orders",
        cart: "POST /v1/cart/validate",
        checkout: "POST /v1/checkout — POST /v1/checkout/guest-otp",
        reviews: "POST /v1/reviews",
        tracking: "GET /v1/tracking/session — POST /v1/tracking/events — POST /v1/tracking/consent",
        admin: "/v1/admin/** (auth, dashboard, products, categories, orders, customers, coupons, banners, reviews, suppliers, analytics, reports, settings, team, upload, maintenance, notifications)",
      },
      docs: "docs/API.md",
    },
    200,
    { "Cache-Control": "no-store" }
  )
);

// ── Versioned surface ───────────────────────────────────────────────
// Canonical API surface. The storefront + admin runtime proxies map their
// same-origin /api/* paths onto these routes (see apps/*/src/lib/backend-proxy.ts).

const v1 = new Hono<{ Bindings: Env }>();

// Public catalog
v1.route("/products", products);
v1.route("/categories", categories);
v1.route("/settings", settingsApi);
v1.route("/media", media);
v1.route("/orders", ordersApi);

// Customer auth + account + commerce
v1.route("/auth", authApi);
v1.route("/account", accountApi);
v1.route("/cart", checkoutApi); // POST /cart/validate
v1.route("/checkout", checkoutApi);
v1.route("/reviews", reviewsApi);
v1.route("/tracking", trackingApi);
v1.route("/storefront", storefrontApi);

// Admin surface
const admin = new Hono<{ Bindings: Env }>();
admin.route("/auth", adminAuthApi);
admin.route("/dashboard", adminDashboardApi);
admin.route("/products", adminProductsApi);
admin.route("/categories", adminCategoriesApi);
admin.route("/orders", adminOrdersApi);
admin.route("/customers", adminCustomersApi);
admin.route("/coupons", adminCouponsApi);
admin.route("/banners", adminBannersApi);
admin.route("/reviews", adminReviewsApi);
admin.route("/suppliers", adminSuppliersApi);
admin.route("/analytics", adminAnalyticsApi);
admin.route("/reports", adminReportsApi);
admin.route("/settings", adminSettingsApi);
admin.route("/maintenance", adminMaintenanceApi);
admin.route("/notifications", adminNotificationsApi);
admin.route("/upload", adminUploadApi);
admin.route("/team", adminTeamApi);
v1.route("/admin", admin);

app.route(`/${API_VERSION}`, v1);

// ── Errors ──────────────────────────────────────────────────────────

app.notFound((c) => c.json(errBody("Route not found", "NOT_FOUND"), 404));

app.onError((err, c) => {
  // HttpError — the standard envelope thrown by guards (auth/permission
  // failures etc.). Body shape matches the monolith's fail() exactly.
  if (err instanceof HttpError) {
    return c.json(err.body as never, err.status as 400);
  }
  // CheckoutError — customer-friendly checkout failures (stock, coupon, TrxID)
  if (err instanceof CheckoutError) {
    return c.json(errBody(err.message), err.status as 400);
  }
  // Structured server-side log — never leak stack traces to clients.
  console.error(
    JSON.stringify({
      level: "error",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
    })
  );
  return c.json(errBody("Internal server error", "INTERNAL"), 500);
});

// ── Scheduled jobs (Cloudflare Cron Triggers — see wrangler.jsonc) ────
// Hourly: supplier price/stock sync for active suppliers with auto-sync
// enabled + retry of failed supplier orders + tracking retention (throttled
// internally). Manual/forced variants remain available to operators through
// the admin maintenance endpoint.

async function runScheduledTasks(env: Env): Promise<void> {
  bridgeEnv(env);
  const { db } = await import("./lib/db");
  const { syncSupplierPricesAndStock } = await import("./lib/suppliers/sync");
  const { retryFailedSupplierOrders } = await import("./lib/suppliers/orders");

  try {
    // Price + stock sync for every active supplier with auto-sync enabled.
    // (Suppliers without API credentials — the demo adapter — complete
    // normally; real adapters log failures into SupplierSyncLog + notify.)
    const suppliers = await db.supplier.findMany({ where: { isActive: true } });
    for (const supplier of suppliers) {
      if (supplier.autoSyncPrice) {
        await syncSupplierPricesAndStock(supplier, "PRICES").catch((e) =>
          console.error(`[cron] price sync failed for ${supplier.code}:`, e)
        );
      }
      if (supplier.autoSyncStock) {
        await syncSupplierPricesAndStock(supplier, "STOCK").catch((e) =>
          console.error(`[cron] stock sync failed for ${supplier.code}:`, e)
        );
      }
    }
    await retryFailedSupplierOrders();
  } catch (e) {
    console.error("[cron] supplier sync pass failed:", e);
  }

  try {
    const { maybeRunRetention } = await import("./lib/tracking");
    await maybeRunRetention();
  } catch (e) {
    console.error("[cron] retention pass failed:", e);
  }
}

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledTasks(env));
  },
};
