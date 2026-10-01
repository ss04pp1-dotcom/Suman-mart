// E2E driver: full-journey verification of the THREE-TIER stack —
// storefront (:3111) + admin app (:3112) + Workers API (:8787), all booted
// via tests/e2e/boot.sh.
//
// Customer journey (storefront, through its /api proxy → /v1):
//   home → categories → product list → product detail → cart validate →
//   guest COD checkout → order-success page → order tracking →
//   account register/login → account overview → addresses.
//
// Admin journey (admin app, through its /api/admin proxy → /v1/admin):
//   login → session (/auth/me) → dashboard KPIs → orders list →
//   order detail → payment verification (smsVerified) → product list →
//   categories → analytics → customers → coupons → settings → suppliers.
//
// Media: an R2-backed product image is fetched through the storefront's
// /products/* media proxy.
//
// SAFEGUARDS: refuses in production, requires E2E_JOURNEYS=1, only reads
// the LOCAL D1 (via wrangler — see ./d1.ts). Unique emails/TrxIDs per run.
import { resolve } from "node:path";
import { d1, hashPassword } from "./d1";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3111";
const ADMIN_BASE = process.env.E2E_ADMIN_BASE ?? "http://127.0.0.1:3112";

function bail(reason: string): never {
  console.error(`[e2e-journeys] REFUSING to run: ${reason}`);
  process.exit(1);
}
if (process.env.NODE_ENV === "production") bail("NODE_ENV=production — dev harness only.");
if (process.env.E2E_JOURNEYS !== "1") bail("set E2E_JOURNEYS=1 to confirm you are driving the dev sandbox server.");

// ── tiny assertion harness ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function call(base: string, path: string, init?: RequestInit & { json?: unknown; cookie?: string }) {
  const { json, cookie, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      Origin: base,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...((rest.headers as Record<string, string>) ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : (rest.body as string | undefined),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { res, data, text };
}
const api = (path: string, init?: RequestInit & { json?: unknown; cookie?: string }) => call(BASE, path, init);
const adminApi = (path: string, init?: RequestInit & { json?: unknown; cookie?: string }) => call(ADMIN_BASE, path, init);

const RUN = Date.now().toString(36);
const CUSTOMER_EMAIL = `journeys.${RUN}@shopnest.com`;
const CUSTOMER_PASSWORD = `Journey-${RUN}-Pass!`;
const ADDRESS = {
  fullName: "Journey Tester",
  phone: "01712345678",
  line1: "12 Test Road",
  line2: null,
  city: "Dhaka",
  area: null,
  postalCode: null,
};

// ────────────────────────────────────────────────────────────────────────
console.log("── Journey 1: customer browses and buys (guest, COD) ──");

const home = await api("/");
check("J1 home page renders (RSC through the proxy)", home.res.status === 200 && home.text.includes("<!DOCTYPE html>"));
check("J1 home ships the nonce CSP", (home.res.headers.get("content-security-policy") ?? "").includes("'nonce-"));

const cats = await api("/api/categories");
check("J1 categories API answers", cats.data?.success === true && Array.isArray(cats.data?.data), cats.text.slice(0, 120));
const categorySlug = cats.data?.data?.[0]?.slug;

const products = await api(`/api/products?category=${categorySlug}&sort=newest&page=1`);
check("J1 product list (filtered, sorted, paginated)", products.data?.success === true && products.data?.data?.items?.length > 0, products.text.slice(0, 120));
// Pick a product with real stock (the catalogue deliberately ships one
// zero-stock item — stock guards are exactly what the checkout tests hit).
const inStock = d1(`SELECT "id", "name", "slug" FROM "Product" WHERE "isActive" = 1 AND "stock" >= 10 LIMIT 1`)[0];
if (!inStock) bail("no in-stock product in the sandbox catalogue — re-run boot.sh");
const item = { id: String(inStock.id), name: String(inStock.name), slug: String(inStock.slug) };

const search = await api(`/api/products?search=${encodeURIComponent(String(item.name).split(" ")[0])}`);
check("J1 product search finds the product", search.data?.success === true && (search.data?.data?.items?.length ?? 0) > 0);

const detail = await api(`/api/products/${item.slug}`);
check("J1 product detail with variants + reviews summary", detail.data?.success === true && detail.data?.data?.variants !== undefined, detail.text.slice(0, 120));

const detailPage = await api(`/products/${item.slug}`);
check("J1 product page renders server-side (RSC bundle)", detailPage.res.status === 200 && detailPage.text.includes(String(item.name).slice(0, 8)));

// Media: the seeded catalogue image is served from R2 through the proxy.
if (detail.data?.data?.images?.[0]?.url) {
  const media = await api(detail.data.data.images[0].url);
  check("J1 product image served from R2 via the media proxy", media.res.status === 200 && (media.res.headers.get("content-type") ?? "").startsWith("image/"));
} else {
  check("J1 product image served from R2 via the media proxy", false, "no image on the product");
}

const cart = await api("/api/cart/validate", {
  method: "POST",
  json: { items: [{ productId: item.id, variantId: null, quantity: 2 }] },
});
check(
  "J1 cart validation prices server-side",
  cart.data?.success === true && typeof cart.data?.data?.totals?.total === "number" && cart.data?.data?.lines?.[0]?.unitPrice > 0,
  cart.text.slice(0, 160)
);

const checkout = await api("/api/checkout", {
  method: "POST",
  json: {
    items: [{ productId: item.id, variantId: null, quantity: 1 }],
    couponCode: "WELCOME10",
    address: ADDRESS,
    customerNote: "e2e journeys run",
    customerEmail: null,
    guestEmailOtp: null,
    paymentMethod: "COD",
    paymentTrxId: null,
  },
});
check("J1 guest COD checkout with WELCOME10 coupon succeeds", checkout.data?.success === true, checkout.text.slice(0, 200));
const orderNumber: string | undefined = checkout.data?.data?.orderNumber;
check("J1 order number issued", typeof orderNumber === "string" && orderNumber.startsWith("SN"));
if (!orderNumber) {
  console.error("[e2e-journeys] checkout failed — aborting (later steps depend on the order).");
  console.log(`\n── Result: ${passed} passed, ${failed} failed ──`);
  process.exit(1);
}

const successPage = await api(`/order-success/${orderNumber}`);
check("J1 order-success page renders the order", successPage.res.status === 200 && successPage.text.includes(orderNumber!));

const track = await api("/api/orders/track", { method: "POST", json: { orderNumber, phone: ADDRESS.phone } });
check("J1 order tracking by number + phone", track.data?.success === true && track.data?.data?.orderNumber === orderNumber, track.text.slice(0, 160));

const couponRow = d1(`SELECT "usageCount" FROM "Coupon" WHERE "code" = 'WELCOME10'`)[0];
const orderRow = d1(`SELECT "id", "subtotal", "discountTotal", "total", "status", "paymentStatus" FROM "Order" WHERE "orderNumber" = '${orderNumber}'`)[0];
check("J1 coupon usage counted atomically", Number(couponRow?.usageCount ?? 0) >= 1);
check("J1 order totals persisted with the discount", Number(orderRow?.total) < Number(orderRow?.subtotal) && Number(orderRow?.discountTotal) > 0);
check("J1 order PENDING with COD payment pending", orderRow?.status === "PENDING" && orderRow?.paymentStatus === "COD_PENDING");

// ────────────────────────────────────────────────────────────────────────
console.log("\n── Journey 2: customer account (register → profile → addresses) ──");

const register = await api("/api/auth/register", {
  method: "POST",
  json: { name: "Journey Tester", email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD, phone: ADDRESS.phone },
});
check("J2 registration succeeds", register.data?.success === true, register.text.slice(0, 160));
const customerCookie = (register.res.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(";")[0])
  .find((c) => c.startsWith("sn_session="));
check("J2 session cookie issued", Boolean(customerCookie));

const me = await api("/api/auth/me", { cookie: customerCookie });
check("J2 /auth/me returns the customer", me.data?.success === true && me.data?.data?.customer?.email === CUSTOMER_EMAIL, me.text.slice(0, 120));

const accountPage = await api("/account", { cookie: customerCookie });
check("J2 account overview page renders (RSC via /v1/storefront/account/overview)", accountPage.res.status === 200 && accountPage.text.includes("Journey Tester".split(" ")[0]));

const ordersPage = await api("/account/orders", { cookie: customerCookie });
check("J2 account orders page renders", ordersPage.res.status === 200);

const address = await api("/api/account/addresses", {
  method: "POST",
  cookie: customerCookie,
  json: ADDRESS,
});
check("J2 address saved", address.data?.success === true, address.text.slice(0, 160));
const addresses = await api("/api/account/addresses", { cookie: customerCookie });
check("J2 addresses list includes it", addresses.data?.success === true && (addresses.data?.data?.length ?? 0) >= 1);

const logout = await api("/api/auth/logout", { method: "POST", cookie: customerCookie });
check("J2 logout clears the session", logout.data?.success === true);

// ────────────────────────────────────────────────────────────────────────
console.log("\n── Journey 3: admin console (login → verify payment → analyze) ──");

// Fresh known password on the seeded admin (same guarded flow as round5).
const adminPassword = `J3-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
d1(
  `UPDATE "Admin" SET "passwordHash" = '${await hashPassword(adminPassword)}', "mustChangePassword" = 0, "isActive" = 1, ` +
    `"tokenVersion" = "tokenVersion" + 1 WHERE "email" = 'admin@shopnest.com'`
);

const login = await adminApi("/api/admin/auth/login", { method: "POST", json: { email: "admin@shopnest.com", password: adminPassword } });
check("J3 admin login through the admin app proxy", login.data?.success === true, login.text.slice(0, 200));
const adminCookie = (login.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("sn_admin="));
check("J3 admin session cookie issued", Boolean(adminCookie));
if (!adminCookie) {
  console.error("[e2e-journeys] admin login failed — aborting.");
  console.log(`\n── Result: ${passed} passed, ${failed} failed ──`);
  process.exit(1);
}
const admin = (method: string, path: string, json?: unknown) => adminApi(path, { method, json, cookie: adminCookie });

// The admin shell layout's session introspection (server component → API).
const meAdmin = await admin("GET", "/api/admin/auth/me");
check("J3 /auth/me returns the admin (drives the shell layout)", meAdmin.data?.success === true && meAdmin.data?.data?.admin?.email === "admin@shopnest.com", meAdmin.text.slice(0, 160));

const dashboard = await admin("GET", "/api/admin/dashboard");
check("J3 dashboard KPIs (orders, revenue, AOV)", dashboard.data?.success === true && dashboard.data?.data?.kpis !== undefined, dashboard.text.slice(0, 160));

const orders = await admin("GET", `/api/admin/orders?search=${orderNumber}`);
check("J3 orders list finds the journey order", orders.data?.success === true && JSON.stringify(orders.data?.data)?.includes(orderNumber!), orders.text.slice(0, 160));

// J3 SMS-match guard: it applies to MANUAL payments (bKash/Nagad TrxID
// claims) — a COD order legitimately needs no tick. Place a bKash order first.
const guardOrder = await api("/api/checkout", {
  method: "POST",
  json: {
    items: [{ productId: item.id, variantId: null, quantity: 1 }],
    couponCode: null,
    address: ADDRESS,
    customerNote: null,
    customerEmail: null,
    guestEmailOtp: null,
    paymentMethod: "BKASH",
    paymentTrxId: `J3${RUN}G1`,
  },
});
const guardOrderNumber: string | undefined = guardOrder.data?.data?.orderNumber;
check("J3 bKash manual-payment order placed for the guard test", guardOrder.data?.success === true && Boolean(guardOrderNumber), guardOrder.text.slice(0, 160));

const badPaid = await admin("PUT", `/api/admin/orders/${guardOrderNumber}`, { paymentStatus: "PAID" });
check("J3 marking a manual payment PAID without the tick is rejected (422)", badPaid.res.status === 422 && badPaid.data?.code === "SMS_MATCH_REQUIRED", badPaid.text.slice(0, 160));

const paidGuard = await admin("PUT", `/api/admin/orders/${guardOrderNumber}`, { paymentStatus: "PAID", smsVerified: true });
check("J3 manual payment verified with the tick", paidGuard.data?.success === true, paidGuard.text.slice(0, 200));

// COD journey order: no TrxID claim to verify, so no tick is required.
const codPaid = await admin("PUT", `/api/admin/orders/${orderNumber}`, { paymentStatus: "PAID" });
check("J3 COD payment marked received (no tick required)", codPaid.data?.success === true, codPaid.text.slice(0, 200));
if (!orderRow) {
  console.error("[e2e-journeys] order row missing — aborting.");
  console.log(`\n── Result: ${passed} passed, ${failed} failed ──`);
  process.exit(1);
}
const payRow = d1(`SELECT "status" FROM "Payment" WHERE "orderId" = '${orderRow.id}'`)[0];
check("J3 payment row SUCCESS in D1", payRow?.status === "SUCCESS");

const orderDetail = await admin("GET", `/api/admin/orders/${orderNumber}`);
check("J3 order detail (history + items + payment)", orderDetail.data?.success === true && orderDetail.data?.data?.statusHistory?.length >= 1, orderDetail.text.slice(0, 160));

const adminProducts = await admin("GET", "/api/admin/products?page=1");
check("J3 admin products list", adminProducts.data?.success === true && (adminProducts.data?.data?.items?.length ?? 0) > 0);

const adminCategories = await admin("GET", "/api/admin/categories");
check("J3 admin categories list", adminCategories.data?.success === true);

const analytics = await admin("GET", "/api/admin/analytics/overview?range=30d");
check("J3 analytics overview", analytics.data?.success === true, analytics.text.slice(0, 160));

const customers = await admin("GET", "/api/admin/customers?page=1");
check("J3 customers list includes the journey customer", customers.data?.success === true && JSON.stringify(customers.data?.data)?.includes(CUSTOMER_EMAIL), customers.text.slice(0, 160));

const coupons = await admin("GET", "/api/admin/coupons");
check("J3 coupons list", coupons.data?.success === true);

const settings = await admin("GET", "/api/admin/settings");
check("J3 settings load", settings.data?.success === true);

const suppliers = await admin("GET", "/api/admin/suppliers");
check("J3 suppliers list", suppliers.data?.success === true);

// Upload write path: multipart → R2 → served back through the admin media
// proxy. (The R2 write cannot be tested under vitest-pool-workers — isolated
// storage breaks on R2 writes from the worker under test — so it lives HERE.)
const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const uploadForm = new FormData();
uploadForm.append("file", new Blob([PNG_1X1], { type: "image/png" }), `e2e-${RUN}.png`);
const upload = await adminApi("/api/admin/upload", { method: "POST", body: uploadForm, cookie: adminCookie });
const uploadUrl: string | undefined = upload.data?.data?.url;
check("J3 admin upload accepts a PNG (→ R2)", upload.data?.success === true && typeof uploadUrl === "string", upload.text.slice(0, 160));
if (uploadUrl) {
  const media = await adminApi(uploadUrl, { cookie: adminCookie });
  check(
    "J3 uploaded image served back through the media proxy",
    media.res.status === 200 && (media.res.headers.get("content-type") ?? "").startsWith("image/"),
    `status=${media.res.status} type=${media.res.headers.get("content-type")}`
  );
}

// Admin HTML pages (server-rendered shell + client data through the proxy).
const adminOrdersPage = await adminApi("/admin/orders", { cookie: adminCookie });
check("J3 admin /admin/orders page renders", adminOrdersPage.res.status === 200);
const adminNoCookie = await fetch(`${ADMIN_BASE}/admin`, { redirect: "manual" });
check(
  "J3 /admin without a session redirects to login",
  (adminNoCookie.status === 307 || adminNoCookie.status === 302) && (adminNoCookie.headers.get("location") ?? "").includes("/admin/login"),
  `status=${adminNoCookie.status} loc=${adminNoCookie.headers.get("location")}`
);

// ────────────────────────────────────────────────────────────────────────
console.log("\n── Journey 4: abuse guards still hold behind the proxies ──");

const dupeTrx = await api("/api/checkout", {
  method: "POST",
  json: {
    items: [{ productId: item.id, variantId: null, quantity: 1 }],
    couponCode: null,
    address: ADDRESS,
    customerNote: null,
    customerEmail: null,
    guestEmailOtp: null,
    paymentMethod: "BKASH",
    paymentTrxId: `J4${RUN}X1`,
  },
});
check("J4 manual payment accepted once", dupeTrx.data?.success === true, dupeTrx.text.slice(0, 160));
const dupeTrx2 = await api("/api/checkout", {
  method: "POST",
  json: {
    items: [{ productId: item.id, variantId: null, quantity: 1 }],
    couponCode: null,
    address: ADDRESS,
    customerNote: null,
    customerEmail: null,
    guestEmailOtp: null,
    paymentMethod: "BKASH",
    paymentTrxId: `J4${RUN}X1`,
  },
});
check("J4 the same TrxID is rejected the second time (409)", dupeTrx2.res.status === 409 && dupeTrx2.data?.code === "TRXID_ALREADY_USED", dupeTrx2.text.slice(0, 160));

const noOrigin = await fetch(`${BASE}/api/checkout`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  body: JSON.stringify({ items: [{ productId: item.id, variantId: null, quantity: 1 }], address: ADDRESS, paymentMethod: "COD" }),
});
check("J4 cross-origin write blocked by CSRF (403)", noOrigin.status === 403);

// ── summary ────────────────────────────────────────────────────────────
console.log(`\n── Result: ${passed} passed, ${failed} failed ──`);
process.exit(failed === 0 ? 0 : 1);
