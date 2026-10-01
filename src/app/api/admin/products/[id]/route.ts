import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { productSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { stringifyJSON, parseJSON } from "@/lib/json";
import { slugify } from "@/lib/format";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("products.view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

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
  if (!product) return fail("Product not found", 404);

  return ok({
    ...product,
    specifications: parseJSON(product.specifications, []),
    tags: product.tags.map((t) => t.tag.name),
    relatedProductIds: product.relationsFrom.filter((r) => r.type === "RELATED").map((r) => r.relatedProduct.id),
    relatedProductNames: product.relationsFrom.filter((r) => r.type === "RELATED").map((r) => r.relatedProduct.name),
    fbtProductIds: product.relationsFrom.filter((r) => r.type === "FBT").map((r) => r.relatedProduct.id),
    fbtProductNames: product.relationsFrom.filter((r) => r.type === "FBT").map((r) => r.relatedProduct.name),
    variants: product.variants.map((v) => ({ id: v.id, name: v.name, options: parseJSON(v.options, {}), sku: v.sku, price: v.price, stock: v.stock })),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) return fail("Product not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = productSchema.partial().safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid product data", 422);
  const input = parsed.data;

  const slug = input.slug ? slugify(input.slug) : undefined;
  if (slug && slug !== existing.slug) {
    const dupe = await db.product.findUnique({ where: { slug } });
    if (dupe) return fail("A product with this slug already exists", 409);
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
  return ok(product);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const existing = await db.product.findUnique({ where: { id }, include: { _count: { select: { orderItems: true } } } });
  if (!existing) return fail("Product not found", 404);
  if (existing._count.orderItems > 0) {
    // Preserve order history — soft archive instead of hard delete
    await db.product.update({ where: { id }, data: { isActive: false } });
    await writeAudit(guard.admin.id, "product.archived", "product", id, { name: existing.name, reason: "has orders" });
    return ok({ deleted: false, archived: true, message: "Product has order history — archived instead of deleted." });
  }

  await db.product.delete({ where: { id } });
  await writeAudit(guard.admin.id, "product.deleted", "product", id, { name: existing.name });
  return ok({ deleted: true });
}
