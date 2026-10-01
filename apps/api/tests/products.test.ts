import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./helpers";

beforeAll(initDb);
import { SELF } from "cloudflare:test";

interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  isFeatured: boolean;
  imageUrl: string | null;
  hoverImageUrl: string | null;
  category: { name: string; slug: string };
  tags: { slug: string; name: string }[];
}

interface ListBody {
  success: boolean;
  data: { items: ProductListItem[]; total: number; page: number; limit: number; totalPages: number; tags: { slug: string; name: string }[] };
}

async function list(query = ""): Promise<{ res: Response; body: ListBody }> {
  const res = await SELF.fetch(`http://localhost/v1/products${query}`);
  const body = (await res.json()) as ListBody;
  return { res, body };
}

describe("GET /v1/products", () => {
  it("lists only ACTIVE products in the default featured/best-selling order", async () => {
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const ids = body.data.items.map((p) => p.id);
    expect(ids).not.toContain("p7"); // inactive stays hidden
    expect(ids[0]).toBe("p1"); // isFeatured desc, then soldCount desc
    expect(ids.slice(1)).toEqual(["p3", "p2", "p6", "p4", "p5", "p8"]);
    expect(body.data.total).toBe(7);
    expect(body.data.totalPages).toBe(1);
    // facet tags come from tags with at least one ACTIVE product
    expect(body.data.tags.map((t) => t.slug).sort()).toEqual(["eco", "wireless"]);
  });

  it("attaches first/second image as imageUrl/hoverImageUrl", async () => {
    const { body } = await list();
    const p1 = body.data.items.find((p) => p.id === "p1")!;
    expect(p1.imageUrl).toBe("/products/earbuds-1.jpg");
    expect(p1.hoverImageUrl).toBe("/products/earbuds-2.jpg");
    const p2 = body.data.items.find((p) => p.id === "p2")!;
    expect(p2.imageUrl).toBe("/products/charger.jpg");
    expect(p2.hoverImageUrl).toBeNull();
  });

  it("searches name, shortDescription and brand", async () => {
    const byBrand = await list("?q=bdwear");
    expect(byBrand.body.data.items.map((p) => p.id)).toEqual(["p3", "p4"]);
    const byName = await list("?q=EARBUDS");
    expect(byName.body.data.items.map((p) => p.id)).toEqual(["p1"]); // LIKE is ASCII case-insensitive
  });

  it("filters by category slug", async () => {
    const { body } = await list("?category=home-living");
    expect(body.data.items.map((p) => p.id).sort()).toEqual(["p5", "p6"]);
    expect(body.data.items[0].category.slug).toBe("home-living");
  });

  it("filters by tag slug", async () => {
    const { body } = await list("?tag=wireless");
    expect(body.data.items.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("COMBINES minPrice and maxPrice into one range", async () => {
    const { body } = await list("?minPrice=800&maxPrice=1500");
    expect(body.data.items.map((p) => p.id).sort()).toEqual(["p2", "p3", "p5"]);
  });

  it("filters availability", async () => {
    const inStock = await list("?availability=in_stock");
    expect(inStock.body.data.items.map((p) => p.id)).not.toContain("p2");
    const outOfStock = await list("?availability=out_of_stock");
    expect(outOfStock.body.data.items.map((p) => p.id)).toEqual(["p2"]);
  });

  it("filters featured", async () => {
    const { body } = await list("?featured=true");
    expect(body.data.items.map((p) => p.id)).toEqual(["p1"]);
  });

  it("sorts by price ascending", async () => {
    const { body } = await list("?sort=price_asc");
    expect(body.data.items.map((p) => p.price)).toEqual([700, 800, 1200, 1500, 2000, 2500, 3200]);
  });

  it("paginates with page/limit", async () => {
    const page1 = await list("?limit=2&page=1");
    expect(page1.body.data.items.length).toBe(2);
    expect(page1.body.data.total).toBe(7);
    expect(page1.body.data.totalPages).toBe(4);
    const page3 = await list("?limit=2&page=3");
    expect(page3.body.data.items.length).toBe(2);
    expect(page3.body.data.page).toBe(3);
  });

  it("rejects invalid query parameters with 422", async () => {
    const res = await SELF.fetch("http://localhost/v1/products?sort=bogus");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { success: boolean; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /v1/products/:slug", () => {
  async function detail(slug: string) {
    const res = await SELF.fetch(`http://localhost/v1/products/${slug}`);
    return { res, body: (await res.json()) as any };
  }

  it("returns the full public product detail", async () => {
    const { res, body } = await detail("wireless-earbuds-pro");
    expect(res.status).toBe(200);
    const p = body.data;
    expect(p.id).toBe("p1");
    expect(p.category).toEqual({ name: "Electronics", slug: "electronics" });
    expect(p.images.map((i: any) => i.url)).toEqual(["/products/earbuds-1.jpg", "/products/earbuds-2.jpg"]);
    // variants carry PARSED options (not the raw JSON string)
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0].options).toEqual({ Color: "Black" });
    expect(p.variants[0].price).toBe(2600);
    // only APPROVED reviews are public
    expect(p.reviews.map((r: any) => r.id)).toEqual(["r3", "r1"]); // newest first
    expect(p.reviews.find((r: any) => r.id === "r3").adminReply).toBe("Thanks for the review!");
    // specifications parse as JSON array
    expect(Array.isArray(p.specifications)).toBe(true);
  });

  it("NEVER exposes supplier costPrice", async () => {
    const { body } = await detail("wireless-earbuds-pro");
    expect(Object.keys(body.data)).not.toContain("costPrice");
  });

  it("merges manual + auto recommendations (same category / shared tags)", async () => {
    const { body } = await detail("wireless-earbuds-pro");
    const relatedIds: string[] = body.data.related.map((r: any) => r.id);
    // manual relation first (p2), then auto-fill from the SAME category (p8)
    expect(relatedIds).toEqual(["p2", "p8"]);
    expect(relatedIds).not.toContain("p1"); // never recommends itself
    expect(relatedIds).not.toContain("p7"); // inactive never recommended
    expect(relatedIds).not.toContain("p3"); // fashion + no shared tag → not auto-picked
    // every recommendation carries its first image
    expect(body.data.related.find((r: any) => r.id === "p8").imageUrl).toBe("/products/hub.jpg");
  });

  it("returns manual FBT products", async () => {
    const { body } = await detail("wireless-earbuds-pro");
    expect(body.data.frequentlyBoughtTogether.map((r: any) => r.id)).toEqual(["p3", "p4"]);
  });

  it("404s unknown slugs with the error envelope", async () => {
    const { res, body } = await detail("nope-does-not-exist");
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("404s INACTIVE product slugs", async () => {
    const { res } = await detail("old-product");
    expect(res.status).toBe(404);
  });
});
