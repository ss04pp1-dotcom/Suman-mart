import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, pageParams, paginated, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { productSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { stringifyJSON } from "@/lib/json";
import { slugify } from "@/lib/format";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("products.view");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
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

  return ok({
    ...paginated(items.map((p) => ({ ...p, imageUrl: p.images[0]?.url ?? null })), total, page, limit),
    categories,
  });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid product data", 422);
  const input = parsed.data;

  const slug = input.slug ? slugify(input.slug) : `${slugify(input.name)}-${Date.now().toString(36)}`;
  const dupe = await db.product.findUnique({ where: { slug } });
  if (dupe) return fail("A product with this slug already exists", 409);

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
  return ok(product);
}
