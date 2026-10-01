import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

describe("GET /v1/categories", () => {
  it("returns ACTIVE categories, sorted, with active-product counts", async () => {
    const res = await SELF.fetch("http://localhost/v1/categories");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; name: string; slug: string; productCount: number }[];
    };
    expect(body.success).toBe(true);
    expect(body.data.map((c) => c.slug)).toEqual(["electronics", "fashion", "home-living"]);
    // archived category hidden; counts exclude the INACTIVE product p7
    expect(body.data.find((c) => c.slug === "electronics")!.productCount).toBe(3); // p1, p2, p8
    expect(body.data.find((c) => c.slug === "fashion")!.productCount).toBe(2);
    expect(body.data.find((c) => c.slug === "home-living")!.productCount).toBe(2);
  });
});
