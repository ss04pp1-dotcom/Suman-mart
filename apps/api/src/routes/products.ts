// /v1/products — public catalog reads (D1 port of the monolith's
// apps/storefront/src/app/api/products/**/route.ts).
//
// Semantics intentionally identical: filters, sorts, pagination caps and the
// response shapes all match the original so clients can switch base URLs.
// One deliberate difference: `costPrice` (supplier cost) is NOT part of the
// public contract here — the monolith's detail route leaked it via a raw
// `...product` spread; this port omits it (fix, not regression).

import { Hono } from "hono";
import type { Env } from "../env";
import { fail, ok, pageParams, paginated } from "../lib/respond";
import { inPlaceholders, likePattern, parseJSON, toBool } from "../lib/d1";
import { productListQuerySchema, type ProductSort } from "@suman-mart/shared";

type Row = Record<string, unknown>;

interface ListWhere {
  sql: string;
  params: unknown[];
}

function buildWhere(query: ReturnType<typeof productListQuerySchema.parse>): ListWhere {
  const clauses: string[] = [`p."isActive" = 1`];
  const params: unknown[] = [];

  if (query.q) {
    const like = likePattern(query.q);
    clauses.push(`(p."name" LIKE ? ESCAPE '\\' OR p."shortDescription" LIKE ? ESCAPE '\\' OR p."brand" LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  if (query.category) {
    clauses.push(`EXISTS (SELECT 1 FROM Category c WHERE c."id" = p."categoryId" AND c."slug" = ?)`);
    params.push(query.category);
  }
  if (query.tag) {
    clauses.push(
      `EXISTS (SELECT 1 FROM ProductTag pt JOIN Tag t ON t."id" = pt."tagId" WHERE pt."productId" = p."id" AND t."slug" = ?)`
    );
    params.push(query.tag);
  }
  if (query.featured === "true") {
    clauses.push(`p."isFeatured" = 1`);
  }
  if (query.minPrice !== undefined && query.maxPrice !== undefined) {
    clauses.push(`p."price" >= ? AND p."price" <= ?`);
    params.push(query.minPrice, query.maxPrice);
  } else if (query.minPrice !== undefined) {
    clauses.push(`p."price" >= ?`);
    params.push(query.minPrice);
  } else if (query.maxPrice !== undefined) {
    clauses.push(`p."price" <= ?`);
    params.push(query.maxPrice);
  }
  if (query.availability === "in_stock") clauses.push(`p."stock" > 0`);
  if (query.availability === "out_of_stock") clauses.push(`p."stock" = 0`);

  return { sql: clauses.join(" AND "), params };
}

function orderBy(sort: ProductSort): string {
  switch (sort) {
    case "newest":
      return `p."createdAt" DESC`;
    case "price_asc":
      return `p."price" ASC`;
    case "price_desc":
      return `p."price" DESC`;
    case "best_selling":
      return `p."soldCount" DESC`;
    case "rating":
      return `p."rating" DESC`;
    case "discount":
      return `p."compareAtPrice" DESC, p."price" ASC`;
    default:
      return `p."isFeatured" DESC, p."soldCount" DESC`;
  }
}

const LIST_SELECT = `
  p."id", p."name", p."slug", p."shortDescription", p."price", p."compareAtPrice",
  p."stock", p."rating", p."reviewCount", p."soldCount", p."brand", p."isFeatured",
  p."createdAt", p."isActive",
  c."name" AS categoryName, c."slug" AS categorySlug`;

async function imagesFor(env: Env, productIds: string[], take: number): Promise<Map<string, { url: string; alt: string | null }[]>> {
  const map = new Map<string, { url: string; alt: string | null }[]>();
  if (productIds.length === 0) return map;
  const rows = await env.DB.prepare(
    `SELECT "productId", "url", "alt" FROM ProductImage WHERE "productId" IN ${inPlaceholders(productIds.length)}
     ORDER BY "productId", "sortOrder" ASC`
  )
    .bind(...productIds)
    .all<Row>();
  for (const r of rows.results ?? []) {
    const id = String(r.productId);
    const list = map.get(id) ?? [];
    if (list.length < take) list.push({ url: String(r.url), alt: r.alt == null ? null : String(r.alt) });
    map.set(id, list);
  }
  return map;
}

async function tagsFor(env: Env, productIds: string[]): Promise<Map<string, { slug: string; name: string }[]>> {
  const map = new Map<string, { slug: string; name: string }[]>();
  if (productIds.length === 0) return map;
  const rows = await env.DB.prepare(
    `SELECT pt."productId" AS productId, t."slug" AS slug, t."name" AS name
     FROM ProductTag pt JOIN Tag t ON t."id" = pt."tagId"
     WHERE pt."productId" IN ${inPlaceholders(productIds.length)}
     ORDER BY pt."productId", t."name"`
  )
    .bind(...productIds)
    .all<Row>();
  for (const r of rows.results ?? []) {
    const id = String(r.productId);
    const list = map.get(id) ?? [];
    list.push({ slug: String(r.slug), name: String(r.name) });
    map.set(id, list);
  }
  return map;
}

function listItem(r: Row, images: { url: string; alt: string | null }[], tags: { slug: string; name: string }[]) {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    shortDescription: r.shortDescription == null ? null : String(r.shortDescription),
    price: Number(r.price),
    compareAtPrice: r.compareAtPrice == null ? null : Number(r.compareAtPrice),
    stock: Number(r.stock),
    rating: Number(r.rating),
    reviewCount: Number(r.reviewCount),
    soldCount: Number(r.soldCount),
    brand: r.brand == null ? null : String(r.brand),
    isFeatured: toBool(r.isFeatured),
    createdAt: r.createdAt,
    category: { name: String(r.categoryName), slug: String(r.categorySlug) },
    images,
    tags,
    imageUrl: images[0]?.url ?? null,
    hoverImageUrl: images[1]?.url ?? null,
  };
}

export const products = new Hono<{ Bindings: Env }>();

products.get("/", async (c) => {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = productListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(c, parsed.error.issues[0]?.message ?? "Invalid query parameters", 422, "VALIDATION_ERROR");
  }
  const query = parsed.data;
  const { page, limit, offset } = pageParams(new URL(c.req.url));
  const where = buildWhere(query);

  const listSql = `
    SELECT ${LIST_SELECT}
    FROM Product p LEFT JOIN Category c ON c."id" = p."categoryId"
    WHERE ${where.sql}
    ORDER BY ${orderBy(query.sort)}
    LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM Product p WHERE ${where.sql}`;

  const [itemsRes, countRes, tagRows] = await Promise.all([
    c.env.DB.prepare(listSql).bind(...where.params, limit, offset).all<Row>(),
    c.env.DB.prepare(countSql).bind(...where.params).first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT t."name" AS name, t."slug" AS slug FROM Tag t
       WHERE EXISTS (
         SELECT 1 FROM ProductTag pt JOIN Product p ON p."id" = pt."productId"
         WHERE pt."tagId" = t."id" AND p."isActive" = 1
       ) ORDER BY t."name"`
    ).all<{ name: string; slug: string }>(),
  ]);

  const items = itemsRes.results ?? [];
  const ids = items.map((r) => String(r.id));
  const [images, tags] = await Promise.all([imagesFor(c.env, ids, 2), tagsFor(c.env, ids)]);

  return ok(c, {
    ...paginated(
      items.map((r) => listItem(r, images.get(String(r.id)) ?? [], tags.get(String(r.id)) ?? [])),
      Number(countRes?.total ?? 0),
      page,
      limit
    ),
    tags: tagRows.results ?? [],
  });
});

products.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const product = await c.env.DB.prepare(
    `SELECT p.*, c."name" AS categoryName, c."slug" AS categorySlug
     FROM Product p LEFT JOIN Category c ON c."id" = p."categoryId"
     WHERE p."slug" = ? AND p."isActive" = 1`
  )
    .bind(slug)
    .first<Row>();

  if (!product) return fail(c, "Product not found", 404, "NOT_FOUND");

  const [imagesRes, variantsRes, reviewsRes, relatedRes, fbtRes] = await Promise.all([
    c.env.DB.prepare(`SELECT "url", "alt" FROM ProductImage WHERE "productId" = ? ORDER BY "sortOrder" ASC`).bind(product.id).all<Row>(),
    c.env.DB.prepare(`SELECT "id", "name", "sku", "price", "stock", "options" FROM ProductVariant WHERE "productId" = ? ORDER BY "sortOrder" ASC`).bind(product.id).all<Row>(),
    c.env.DB.prepare(
      `SELECT "id", "authorName", "rating", "title", "comment", "isFeatured", "createdAt", "adminReply"
       FROM Review WHERE "productId" = ? AND "status" = 'APPROVED'
       ORDER BY "createdAt" DESC LIMIT 20`
    )
      .bind(product.id)
      .all<Row>(),
    c.env.DB.prepare(
      `SELECT rp."id", rp."name", rp."slug", rp."price", rp."compareAtPrice", rp."rating",
              rp."reviewCount", rp."stock", pr."sortOrder"
       FROM ProductRelation pr JOIN Product rp ON rp."id" = pr."relatedProductId"
       WHERE pr."productId" = ? AND pr."type" = 'RELATED'
       ORDER BY pr."sortOrder" ASC LIMIT 8`
    )
      .bind(product.id)
      .all<Row>(),
    c.env.DB.prepare(
      `SELECT rp."id", rp."name", rp."slug", rp."price", rp."compareAtPrice", rp."rating",
              rp."reviewCount", rp."stock", pr."sortOrder"
       FROM ProductRelation pr JOIN Product rp ON rp."id" = pr."relatedProductId"
       WHERE pr."productId" = ? AND pr."type" = 'FBT'
       ORDER BY pr."sortOrder" ASC LIMIT 3`
    )
      .bind(product.id)
      .all<Row>(),
  ]);

  // Auto-recommendations fill the remainder (same category / shared tags),
  // exactly like the monolith.
  const relatedManual = relatedRes.results ?? [];
  const relatedIds = new Set(relatedManual.map((r) => String(r.id)));
  let relatedAuto: Row[] = [];
  if (relatedManual.length < 8) {
    const tagIds = await c.env.DB.prepare(`SELECT "tagId" FROM ProductTag WHERE "productId" = ?`).bind(product.id).all<Row>();
    const tagIdList = (tagIds.results ?? []).map((r) => String(r.tagId));
    const excludeIds = [...relatedIds, String(product.id)];
    const params: unknown[] = [...excludeIds, product.categoryId];
    const groupClause =
      tagIdList.length > 0
        ? `(p."categoryId" = ? OR EXISTS (SELECT 1 FROM ProductTag pt WHERE pt."productId" = p."id" AND pt."tagId" IN ${inPlaceholders(tagIdList.length)}))`
        : `(p."categoryId" = ?)`;
    params.push(...tagIdList);
    const auto = await c.env.DB.prepare(
      `SELECT p."id", p."name", p."slug", p."price", p."compareAtPrice", p."rating",
              p."reviewCount", p."stock"
       FROM Product p
       WHERE p."isActive" = 1 AND p."id" NOT IN ${inPlaceholders(excludeIds.length)} AND ${groupClause}
       ORDER BY p."soldCount" DESC LIMIT ?`
    )
      .bind(...params, 8 - relatedManual.length)
      .all<Row>();
    relatedAuto = auto.results ?? [];
  }

  const recommendationIds = [
    ...relatedManual.map((r) => String(r.id)),
    ...relatedAuto.map((r) => String(r.id)),
    ...(fbtRes.results ?? []).map((r) => String(r.id)),
  ];
  const recImages = await imagesFor(c.env, recommendationIds, 1);
  const asRecommendation = (r: Row) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    price: Number(r.price),
    compareAtPrice: r.compareAtPrice == null ? null : Number(r.compareAtPrice),
    rating: Number(r.rating),
    reviewCount: Number(r.reviewCount),
    stock: Number(r.stock),
    imageUrl: recImages.get(String(r.id))?.[0]?.url ?? null,
  });

  const tagRows = await c.env.DB.prepare(
    `SELECT t."slug" AS slug, t."name" AS name FROM ProductTag pt JOIN Tag t ON t."id" = pt."tagId" WHERE pt."productId" = ? ORDER BY t."name"`
  )
    .bind(product.id)
    .all<{ slug: string; name: string }>();

  // Public detail payload — `costPrice` deliberately excluded (see file header).
  const detail = {
    id: String(product.id),
    name: String(product.name),
    slug: String(product.slug),
    shortDescription: product.shortDescription == null ? null : String(product.shortDescription),
    description: product.description == null ? null : String(product.description),
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice == null ? null : Number(product.compareAtPrice),
    sku: String(product.sku),
    stock: Number(product.stock),
    lowStockThreshold: Number(product.lowStockThreshold),
    isActive: toBool(product.isActive),
    isFeatured: toBool(product.isFeatured),
    brand: product.brand == null ? null : String(product.brand),
    seoTitle: product.seoTitle == null ? null : String(product.seoTitle),
    seoDescription: product.seoDescription == null ? null : String(product.seoDescription),
    rating: Number(product.rating),
    reviewCount: Number(product.reviewCount),
    soldCount: Number(product.soldCount),
    viewCount: Number(product.viewCount),
    categoryId: String(product.categoryId),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    category: { name: String(product.categoryName), slug: String(product.categorySlug) },
    images: (imagesRes.results ?? []).map((r) => ({ url: String(r.url), alt: r.alt == null ? null : String(r.alt) })),
    specifications: parseJSON<{ group: string; key: string; value: string }[]>(product.specifications, []),
    tags: tagRows.results ?? [],
    variants: (variantsRes.results ?? []).map((v) => ({
      id: String(v.id),
      name: String(v.name),
      options: parseJSON<Record<string, string>>(v.options, {}),
      sku: v.sku == null ? null : String(v.sku),
      price: v.price == null ? null : Number(v.price),
      stock: Number(v.stock),
    })),
    reviews: (reviewsRes.results ?? []).map((r) => ({
      id: String(r.id),
      authorName: String(r.authorName),
      rating: Number(r.rating),
      title: r.title == null ? null : String(r.title),
      comment: String(r.comment),
      isFeatured: toBool(r.isFeatured),
      createdAt: r.createdAt,
      adminReply: r.adminReply == null ? null : String(r.adminReply),
    })),
    related: [...relatedManual, ...relatedAuto].map(asRecommendation),
    frequentlyBoughtTogether: (fbtRes.results ?? []).map(asRecommendation),
  };

  return ok(c, detail);
});
