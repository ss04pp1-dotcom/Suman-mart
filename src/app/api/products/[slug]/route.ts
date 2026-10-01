import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { parseJSON } from "@/lib/json";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const product = await db.product.findFirst({
    where: { slug, isActive: true },
    include: {
      category: { select: { name: true, slug: true } },
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { sortOrder: "asc" } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
      reviews: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          authorName: true,
          rating: true,
          title: true,
          comment: true,
          isFeatured: true,
          createdAt: true,
          adminReply: true,
        },
      },
    },
  });

  if (!product) return fail("Product not found", 404);

  // Manual relations first, then auto-recommendations (same category / shared tags)
  const [relatedManual, fbtManual] = await Promise.all([
    db.productRelation.findMany({
      where: { productId: product.id, type: "RELATED" },
      orderBy: { sortOrder: "asc" },
      include: {
        relatedProduct: {
          select: {
            id: true, name: true, slug: true, price: true, compareAtPrice: true,
            rating: true, reviewCount: true, stock: true,
            images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
          },
        },
      },
      take: 8,
    }),
    db.productRelation.findMany({
      where: { productId: product.id, type: "FBT" },
      orderBy: { sortOrder: "asc" },
      include: {
        relatedProduct: {
          select: {
            id: true, name: true, slug: true, price: true, compareAtPrice: true,
            rating: true, reviewCount: true, stock: true,
            images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
          },
        },
      },
      take: 3,
    }),
  ]);

  const relatedIds = new Set(relatedManual.map((r) => r.relatedProduct.id));
  let relatedAuto: typeof relatedManual = [];
  if (relatedManual.length < 8) {
    const tagIds = await db.productTag.findMany({
      where: { productId: product.id },
      select: { tagId: true },
    });
    const auto = await db.product.findMany({
      where: {
        isActive: true,
        id: { notIn: [...relatedIds, product.id] },
        OR: [
          { categoryId: product.categoryId },
          ...(tagIds.length > 0 ? [{ tags: { some: { tagId: { in: tagIds.map((t) => t.tagId) } } } }] : []),
        ],
      },
      orderBy: [{ soldCount: "desc" }],
      take: 8 - relatedManual.length,
      select: {
        id: true, name: true, slug: true, price: true, compareAtPrice: true,
        rating: true, reviewCount: true, stock: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      },
    });
    relatedAuto = auto.map((p) => ({ id: `auto-${p.id}`, sortOrder: 99, productId: product.id, relatedProductId: p.id, type: "RELATED", relatedProduct: p }));
  }

  return ok({
    ...product,
    specifications: parseJSON<{ group: string; key: string; value: string }[]>(product.specifications, []),
    tags: product.tags.map((t) => t.tag),
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      options: parseJSON<Record<string, string>>(v.options, {}),
      sku: v.sku,
      price: v.price,
      stock: v.stock,
    })),
    related: [...relatedManual, ...relatedAuto].map((r) => ({
      id: r.relatedProduct.id,
      name: r.relatedProduct.name,
      slug: r.relatedProduct.slug,
      price: r.relatedProduct.price,
      compareAtPrice: r.relatedProduct.compareAtPrice,
      rating: r.relatedProduct.rating,
      reviewCount: r.relatedProduct.reviewCount,
      stock: r.relatedProduct.stock,
      imageUrl: r.relatedProduct.images[0]?.url ?? null,
    })),
    frequentlyBoughtTogether: fbtManual.map((r) => ({
      id: r.relatedProduct.id,
      name: r.relatedProduct.name,
      slug: r.relatedProduct.slug,
      price: r.relatedProduct.price,
      compareAtPrice: r.relatedProduct.compareAtPrice,
      rating: r.relatedProduct.rating,
      reviewCount: r.relatedProduct.reviewCount,
      stock: r.relatedProduct.stock,
      imageUrl: r.relatedProduct.images[0]?.url ?? null,
    })),
  });
}
