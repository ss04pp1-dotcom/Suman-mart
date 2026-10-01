// /v1/categories — active categories with active-product counts
// (D1 port of apps/storefront/src/app/api/categories/route.ts).

import { Hono } from "hono";
import type { Env } from "../env";
import { ok } from "../lib/respond";

export const categories = new Hono<{ Bindings: Env }>();

categories.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c."id", c."name", c."slug", c."description", c."imageUrl",
            (SELECT COUNT(*) FROM Product p WHERE p."categoryId" = c."id" AND p."isActive" = 1) AS productCount
     FROM Category c
     WHERE c."isActive" = 1
     ORDER BY c."sortOrder" ASC`
  ).all<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl: string | null;
    productCount: number;
  }>();

  return ok(
    c,
    (rows.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      imageUrl: r.imageUrl,
      productCount: Number(r.productCount),
    }))
  );
});
