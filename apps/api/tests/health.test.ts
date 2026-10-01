import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

describe("GET /health", () => {
  it("reports ok with a live D1 binding", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { database: string } };
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });
});

describe("API index & baseline headers", () => {
  it("serves a self-documenting index at /", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; version: string; endpoints: Record<string, string> };
    expect(body.name).toBe("Suman Mart API");
    expect(body.version).toBe("v1");
    expect(Object.keys(body.endpoints)).toContain("products");
  });

  it("stamps X-API-Version + security headers on every response", async () => {
    const res = await SELF.fetch("http://localhost/v1/categories");
    expect(res.headers.get("X-API-Version")).toBe("v1");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the standard error envelope for unknown routes", async () => {
    const res = await SELF.fetch("http://localhost/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("CORS", () => {
  it("echoes any origin (public read API, ALLOWED_ORIGINS=*)", async () => {
    const res = await SELF.fetch("http://localhost/v1/categories", {
      headers: { Origin: "https://shop.example.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("answers preflights with 204 + allowed methods", async () => {
    const res = await SELF.fetch("http://localhost/v1/orders/track", {
      method: "OPTIONS",
      headers: { Origin: "https://shop.example.com", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
