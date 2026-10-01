import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

describe("GET /v1/media/:key (R2)", () => {
  it("serves an object stored in R2 with immutable caching", async () => {
    const res = await SELF.fetch("http://localhost/v1/media/products/earbuds-1.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it("404s missing objects with the standard envelope", async () => {
    const res = await SELF.fetch("http://localhost/v1/media/products/does-not-exist.jpg");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("rejects path traversal keys", async () => {
    const res = await SELF.fetch("http://localhost/v1/media/..%2F..%2Fsecret");
    expect([404, 422]).toContain(res.status);
  });
});
