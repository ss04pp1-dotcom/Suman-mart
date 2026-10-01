// Admin product management — Hono port of
// apps/storefront/src/app/api/admin/products/{route,bulk/route,[id]/route}.ts.
// The bulk adjustPrice $transaction([...]) runs as an atomic D1 batch.

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, pageParams, paginated, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { productSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { stringifyJSON, parseJSON } from "@/lib/json";
import { slugify } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

export const adminProductsApi = new Hono<{ Bindings: Env }>();

function d1(): D1Database {
  const env = (globalThis as unknown as { __apiEnv?: { DB: D1Database } }).__apiEnv;
  if (!env?.DB) throw new Error("products route used before the env bridge ran");
  return env.DB;
}

// GET /v1/admin/products — filtered list
adminProductsApi.get("/", async (c) => {
  await requireAdmin(c, "products.view");

  const url = new URL(c.req.url);
  const { page, limit, skip, take } = pageParams(url, 12);
  const q = url.searchParams.get("q")?.trim();
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  const stock = url.searchParams.get("stock");

  const where: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { brand: { contains: q } }] } : {}),
    ...(category ? { categoryId: category } : {}),
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
    ...(stock === "low" ? { stock: { lte: 5 } } : {}),
    ...(stock === "out" ? { stock: 0 } : {}),
  };

  const [items, total, categories] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, name: true, slug: true, price: true, compareAtPrice: true, stock: true,
        lowStockThreshold: true, isActive: true, isFeatured: true, sku: true, rating: true,
        reviewCount: true, soldCount: true, createdAt: true,
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      },
    }),
    db.product.count({ where }),
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  return ok(c, {
    ...paginated(items.map((p) => ({ ...p, imageUrl: p.images[0]?.url ?? null })), total, page, limit),
    categories,
  });
});

// POST /v1/admin/products — create
adminProductsApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid product data", 422);
  const input = parsed.data;

  const slug = input.slug ? slugify(input.slug) : `${slugify(input.name)}-${Date.now().toString(36)}`;
  const dupe = await db.product.findUnique({ where: { slug } });
  if (dupe) return fail(c, "A product with this slug already exists", 409);

  const product = await db.product.create({
    data: {
      name: input.name,
      slug,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      costPrice: input.costPrice ?? null,
      sku: input.sku,
      stock: input.stock,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      isActive: input.isActive ?? true,
      isFeatured: input.isFeatured ?? false,
      brand: input.brand ?? null,
      specifications: stringifyJSON(input.specifications ?? []),
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      categoryId: input.categoryId,
      images: input.images?.length
        ? { create: input.images.map((img, i) => ({ url: img.url, alt: img.alt ?? input.name, sortOrder: i })) }
        : undefined,
      tags: input.tags?.length
        ? {
            create: input.tags.map((name) => ({
              tag: { connectOrCreate: { where: { slug: slugify(name) }, create: { name, slug: slugify(name) } } },
            })),
          }
        : undefined,
      variants: input.variants?.length
        ? { create: input.variants.map((v, i) => ({ name: v.name, options: stringifyJSON(v.options), sku: v.sku ?? null, price: v.price ?? null, stock: v.stock ?? 0, sortOrder: i })) }
        : undefined,
    },
  });

  // Manual recommendations
  if (input.relatedProductIds?.length) {
    await db.productRelation.createMany({
      data: input.relatedProductIds.map((id, i) => ({ productId: product.id, relatedProductId: id, type: "RELATED", sortOrder: i })),
    }).catch(() => undefined);
  }
  if (input.fbtProductIds?.length) {
    await db.productRelation.createMany({
      data: input.fbtProductIds.map((id, i) => ({ productId: product.id, relatedProductId: id, type: "FBT", sortOrder: i })),
    }).catch(() => undefined);
  }

  await writeAudit(guard.admin.id, "product.created", "product", product.id, { name: product.name });
  return ok(c, product);
});

// POST /v1/admin/products/bulk — bulk operations
adminProductsApi.post("/bulk", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      ids: z.array(z.string()).min(1),
      action: z.enum(["activate", "deactivate", "feature", "unfeature", "delete", "setStock", "adjustPrice"]),
      value: z.number().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, "Invalid bulk action payload", 422);
  const { ids, action, value } = parsed.data;

  let count = 0;
  switch (action) {
    case "activate":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: true } })).count;
      break;
    case "deactivate":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } })).count;
      break;
    case "feature":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isFeatured: true } })).count;
      break;
    case "unfeature":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isFeatured: false } })).count;
      break;
    case "setStock":
      if (value === undefined) return fail(c, "Stock value is required", 422);
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { stock: Math.max(0, Math.round(value)) } })).count;
      break;
    case "adjustPrice": {
      if (value === undefined) return fail(c, "Price adjustment percentage is required", 422);
      const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, price: true } });
      // Atomic D1 batch (was a Prisma array transaction on Node).
      await d1().batch(
        products.map((p) =>
          d1()
            .prepare(`UPDATE "Product" SET "price" = ?1, "updatedAt" = ?2 WHERE "id" = ?3`)
            .bind(Math.max(1, Math.round((p.price * (100 + value)) / 100)), Date.now(), p.id)
        )
      );
      count = products.length;
      break;
    }
    case "delete": {
      const orderItems = await db.orderItem.findMany({ where: { productId: { in: ids } }, select: { productId: true }, take: 1 });
      if (orderItems.length > 0) {
        count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } })).count;
        await writeAudit(guard.admin.id, "product.bulk_archived", "product", null, { ids, reason: "some have order history" });
        return ok(c, { affected: count, archived: true });
      }
      count = (await db.product.deleteMany({ where: { id: { in: ids } } })).count;
      break;
    }
  }

  await writeAudit(guard.admin.id, `product.bulk_${action}`, "product", null, { ids, value });
  return ok(c, { affected: count });
});

// GET /v1/admin/products/:id — 7-tab editor payload
adminProductsApi.get("/:id", async (c) => {
  await requireAdmin(c, "products.view");
  const id = c.req.param("id");

  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { sortOrder: "asc" } },
      tags: { select: { tag: { select: { name: true, slug: true } } } },
      relationsFrom: { include: { relatedProduct: { select: { id: true, name: true } } } },
      supplierProduct: { select: { id: true, externalId: true, supplier: { select: { id: true, name: true } } } },
    },
  });
  if (!product) return fail(c, "Product not found", 404);

  return ok(c, {
    ...product,
    specifications: parseJSON(product.specifications, []),
    tags: product.tags.map((t) => t.tag.name),
    relatedProductIds: product.relationsFrom.filter((r) => r.type === "RELATED").map((r) => r.relatedProduct.id),
    relatedProductNames: product.relationsFrom.filter((r) => r.type === "RELATED").map((r) => r.relatedProduct.name),
    fbtProductIds: product.relationsFrom.filter((r) => r.type === "FBT").map((r) => r.relatedProduct.id),
    fbtProductNames: product.relationsFrom.filter((r) => r.type === "FBT").map((r) => r.relatedProduct.name),
    variants: product.variants.map((v) => ({ id: v.id, name: v.name, options: parseJSON(v.options, {}), sku: v.sku, price: v.price, stock: v.stock })),
  });
});

// PUT /v1/admin/products/:id — update
adminProductsApi.put("/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");
  const id = c.req.param("id");

  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) return fail(c, "Product not found", 404);

  const body = await c.req.json().catch(() => null);
  const parsed = productSchema.partial().safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid product data", 422);
  const input = parsed.data;

  const slug = input.slug ? slugify(input.slug) : undefined;
  if (slug && slug !== existing.slug) {
    const dupe = await db.product.findUnique({ where: { slug } });
    if (dupe) return fail(c, "A product with this slug already exists", 409);
  }

  const product = await db.product.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(slug ? { slug } : {}),
      ...(input.shortDescription !== undefined ? { shortDescription: input.shortDescription } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.stock !== undefined ? { stock: input.stock } : {}),
      ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: input.lowStockThreshold } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.specifications !== undefined ? { specifications: stringifyJSON(input.specifications) } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.images !== undefined
        ? {
            images: {
              deleteMany: {},
              create: input.images.map((img, i) => ({ url: img.url, alt: img.alt ?? input.name ?? existing.name, sortOrder: i })),
            },
          }
        : {}),
      ...(input.variants !== undefined
        ? {
            variants: {
              deleteMany: {},
              create: input.variants.map((v, i) => ({ name: v.name, options: stringifyJSON(v.options), sku: v.sku ?? null, price: v.price ?? null, stock: v.stock ?? 0, sortOrder: i })),
            },
          }
        : {}),
      ...(input.tags !== undefined
        ? {
            tags: {
              deleteMany: {},
              create: input.tags.map((name) => ({
                tag: { connectOrCreate: { where: { slug: slugify(name) }, create: { name, slug: slugify(name) } } },
              })),
            },
          }
        : {}),
    },
  });

  if (input.relatedProductIds) {
    await db.productRelation.deleteMany({ where: { productId: id, type: "RELATED" } });
    if (input.relatedProductIds.length) {
      await db.productRelation.createMany({
        data: input.relatedProductIds.map((rid, i) => ({ productId: id, relatedProductId: rid, type: "RELATED", sortOrder: i })),
      }).catch(() => undefined);
    }
  }
  if (input.fbtProductIds) {
    await db.productRelation.deleteMany({ where: { productId: id, type: "FBT" } });
    if (input.fbtProductIds.length) {
      await db.productRelation.createMany({
        data: input.fbtProductIds.map((rid, i) => ({ productId: id, relatedProductId: rid, type: "FBT", sortOrder: i })),
      }).catch(() => undefined);
    }
  }

  await writeAudit(guard.admin.id, "product.updated", "product", id, { name: product.name });
  return ok(c, product);
});

// DELETE /v1/admin/products/:id — hard delete or soft archive
adminProductsApi.delete("/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");
  const id = c.req.param("id");

  const existing = await db.product.findUnique({ where: { id }, include: { _count: { select: { orderItems: true } } } });
  if (!existing) return fail(c, "Product not found", 404);
  if (existing._count.orderItems > 0) {
    // Preserve order history — soft archive instead of hard delete
    await db.product.update({ where: { id }, data: { isActive: false } });
    await writeAudit(guard.admin.id, "product.archived", "product", id, { name: existing.name, reason: "has orders" });
    return ok(c, { deleted: false, archived: true, message: "Product has order history — archived instead of deleted." });
  }

  await db.product.delete({ where: { id } });
  await writeAudit(guard.admin.id, "product.deleted", "product", id, { name: existing.name });
  return ok(c, { deleted: true });
});
