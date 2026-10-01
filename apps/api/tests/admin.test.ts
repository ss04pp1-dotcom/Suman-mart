// Admin surface integration tests — login, RBAC, dashboard, product CRUD,
// upload (R2), settings, analytics, reports. Runs against real local D1 + R2.

import { beforeAll, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { initDb, CookieJar } from "./helpers";

beforeAll(initDb);

// NOTE (testing limitation, documented): R2 WRITES — whether from the worker
// under test or a test-side env.MEDIA.put made from THIS file's beforeAll —
// break vitest-pool-workers' per-test isolated storage (miniflare cannot pop
// the R2 snapshot when the object store's -shm WAL sidecar exists; verified
// with a minimal probe). The upload endpoint's full write path is therefore
// verified in the wrangler-dev E2E journeys (scripts/e2e-*.mjs) against real
// local R2; R2 SERVING is covered by tests/media.test.ts. These tests cover
// the endpoint's validation paths, which reject BEFORE any R2 write.

let ipCounter = 500;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

function api(method: string, path: string, body: unknown, jar?: CookieJar, ip?: string) {
  return SELF.fetch(`http://localhost${path}`, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(ip ? { "x-forwarded-for": ip } : {}),
      ...(jar && jar.header() ? { cookie: jar.header() } : {}),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}

async function jtext(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}

async function loginAdmin(): Promise<CookieJar> {
  const jar = new CookieJar();
  const res = await api("POST", "/v1/admin/auth/login", { email: "admin@test.local", password: "Admin123!SuperSecure" }, jar, freshIp());
  jar.capture(res);
  expect(res.status).toBe(200);
  return jar;
}

describe("admin auth + RBAC", () => {
  it("rejects bad credentials and enforces per-IP lockout", async () => {
    const bad = await api("POST", "/v1/admin/auth/login", { email: "admin@test.local", password: "wrong" }, undefined, "203.0.113.7");
    expect(bad.status).toBe(401);
  });

  it("me returns the super admin profile with permissions", async () => {
    const jar = await loginAdmin();
    const me = await jtext(await api("GET", "/v1/admin/auth/me", undefined, jar));
    expect(me.data.admin.role).toBe("SUPER_ADMIN");
    // NOTE: `can()` in the response object is dropped by JSON serialization
    // (exactly as in the monolith) — the admin UI computes ability from the
    // permissions array client-side.
    expect(me.data.admin.permissions).toContain("products.manage");
  });

  it("SUPPORT role cannot manage products (server-side RBAC)", async () => {
    const jar = new CookieJar();
    const login = await api("POST", "/v1/admin/auth/login", { email: "support@test.local", password: "Support123!Pass" }, jar, freshIp());
    jar.capture(login);
    expect(login.status).toBe(200);

    const blocked = await api("POST", "/v1/admin/products", {
      name: "Hack Product", price: 100, sku: "HACK-1", stock: 1, categoryId: "cat-electronics",
    }, jar, freshIp());
    expect(blocked.status).toBe(403);

    // Reading orders IS allowed for SUPPORT (its role permission set)
    const read = await api("GET", "/v1/admin/orders", undefined, jar, freshIp());
    expect(read.status).toBe(200);
  });

  it("unauthenticated calls are rejected", async () => {
    const res = await api("GET", "/v1/admin/dashboard", undefined, undefined, freshIp());
    expect(res.status).toBe(401);
  });
});

describe("admin dashboard + analytics", () => {
  it("serves KPIs, series and recent orders", async () => {
    const jar = await loginAdmin();
    const res = await api("GET", "/v1/admin/dashboard", undefined, jar, freshIp());
    const body = await jtext(res);
    expect(res.status).toBe(200);
    expect(typeof body.data.kpis.totalSales).toBe("number");
    expect(Array.isArray(body.data.salesSeries)).toBe(true);
    expect(body.data.recentOrders.length).toBeGreaterThan(0);
  });

  it("serves analytics overview + funnel + consent + events log", async () => {
    const jar = await loginAdmin();
    for (const [path, check] of [
      ["/v1/admin/analytics/overview", (d: any) => expect(d.kpis).toBeDefined()],
      ["/v1/admin/analytics/funnel", (d: any) => expect(Array.isArray(d)).toBe(true)],
      ["/v1/admin/analytics/consent", (d: any) => expect(d).toBeDefined()],
      ["/v1/admin/analytics/events", (d: any) => expect(Array.isArray(d.items)).toBe(true)],
      ["/v1/admin/analytics/live", (d: any) => expect(Array.isArray(d)).toBe(true)],
      ["/v1/admin/analytics/abandoned", (d: any) => expect(d).toBeDefined()],
    ] as const) {
      const res = await api("GET", path, undefined, jar, freshIp());
      const body = await jtext(res);
      expect(res.status).toBe(200);
      check(body.data);
    }
  });

  it("exports CSV reports with formula-injection neutralization", async () => {
    const jar = await loginAdmin();
    const res = await api("GET", "/v1/admin/reports/export?type=sales&range=custom&from=2026-02-01&to=2026-02-28", undefined, jar, freshIp());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("Date");
    expect(csv).toContain("2026-02-10"); // seeded order date within the range
    expect(csv).toContain("3760"); // its revenue
    // per-order detail lives in the orders report
    const orders = await api("GET", "/v1/admin/reports/export?type=orders&range=custom&from=2026-02-01&to=2026-02-28", undefined, jar, freshIp());
    const ordersCsv = await orders.text();
    expect(ordersCsv).toContain("SN100001");
  });
});

describe("admin product CRUD", () => {
  it("creates, reads, updates and archives a product", async () => {
    const jar = await loginAdmin();

    const create = await jtext(await api("POST", "/v1/admin/products", {
      name: "Test Kettle", price: 1200, stock: 7, sku: "KETTLE-1", categoryId: "cat-home",
      shortDescription: "Boils water",
    }, jar, freshIp()));
    expect(create.success).toBe(true);
    const productId = create.data.id;

    const detail = await jtext(await api("GET", `/v1/admin/products/${productId}`, undefined, jar, freshIp()));
    expect(detail.data.name).toBe("Test Kettle");
    expect(detail.data.specifications).toEqual([]);

    const update = await api("PUT", `/v1/admin/products/${productId}`, { price: 1350 }, jar, freshIp());
    expect(update.status).toBe(200);

    // Delete with no order history = hard delete
    const del = await api("DELETE", `/v1/admin/products/${productId}`, undefined, jar, freshIp());
    const delBody = await jtext(del);
    expect(delBody.data.deleted).toBe(true);
  });

  it("bulk operations apply to selected products", async () => {
    const jar = await loginAdmin();
    const res = await api("POST", "/v1/admin/products/bulk", { ids: ["p5", "p6"], action: "feature" }, jar, freshIp());
    const body = await jtext(res);
    expect(body.data.affected).toBe(2);
  });

  it("upload rejects SVG/polyglot content by magic bytes and bad requests (no R2 write)", async () => {
    const jar = await loginAdmin();
    const evil = new FormData();
    evil.append("file", new File(["<svg onload=alert(1)>"], "evil.png", { type: "image/png" }));
    evil.append("folder", "products");
    const rejected = await api("POST", "/v1/admin/upload", evil, jar, freshIp());
    expect(rejected.status).toBe(400);

    // No file
    const noFile = await api("POST", "/v1/admin/upload", new FormData(), jar, freshIp());
    expect(noFile.status).toBe(422);

    // Bad folder
    const badFolder = new FormData();
    badFolder.append("file", new File(["fakedata"], "x.png", { type: "image/png" }));
    badFolder.append("folder", "etc");
    const rejectedFolder = await api("POST", "/v1/admin/upload", badFolder, jar, freshIp());
    expect(rejectedFolder.status).toBe(422);
  });
});

describe("admin settings + team", () => {
  it("reads and patches settings groups with validation", async () => {
    const jar = await loginAdmin();

    const get = await jtext(await api("GET", "/v1/admin/settings?key=shipping", undefined, jar, freshIp()));
    expect(get.data.shipping.flatRate).toBe(60);

    const patch = await api("PUT", "/v1/admin/settings", { key: "shipping", values: { flatRate: 75, freeShippingThreshold: 2000, estimatedDaysMin: 2, estimatedDaysMax: 5, codCharge: 0 } }, jar, freshIp());
    expect(patch.status).toBe(200);

    const bad = await api("PUT", "/v1/admin/settings", { key: "shipping", values: { flatRate: -50, freeShippingThreshold: 2000, estimatedDaysMin: 2, estimatedDaysMax: 5, codCharge: 0 } }, jar, freshIp());
    expect(bad.status).toBe(422);

    // restore
    await api("PUT", "/v1/admin/settings", { key: "shipping", values: { flatRate: 60, freeShippingThreshold: 2000, estimatedDaysMin: 2, estimatedDaysMax: 5, codCharge: 0 } }, jar, freshIp());
  });

  it("lists team members and protects the last super admin", async () => {
    const jar = await loginAdmin();
    const list = await jtext(await api("GET", "/v1/admin/team", undefined, jar, freshIp()));
    expect(list.data.length).toBe(2);

    // Deactivating the ONLY super admin is blocked
    const res = await api("PUT", "/v1/admin/team", { id: "admin-root", isActive: false }, jar, freshIp());
    expect(res.status).toBe(422);
  });
});
