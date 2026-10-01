import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, pageParams, paginated } from "@/lib/api";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const { page, limit, skip, take } = pageParams(url);

  const q = url.searchParams.get("q")?.trim();
  const category = url.searchParams.get("category");
  const tag = url.searchParams.get("tag");
  const minPrice = parseInt(url.searchParams.get("minPrice") ?? "", 10);
  const maxPrice = parseInt(url.searchParams.get("maxPrice") ?? "", 10);
  const availability = url.searchParams.get("availability"); // "in_stock" | "out_of_stock"
  const featured = url.searchParams.get("featured");
  const sort = url.searchParams.get("sort") ?? "featured";

  // minPrice + maxPrice must COMBINE into one price range (spreading them
  // separately overwrites the same key and silently drops the first filter)
  const priceFilter: Prisma.IntFilter | undefined =
    !isNaN(minPrice) && !isNaN(maxPrice)
      ? { gte: minPrice, lte: maxPrice }
      : !isNaN(minPrice)
        ? { gte: minPrice }
        : !isNaN(maxPrice)
          ? { lte: maxPrice }
          : undefined;

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    // Full-text search over the lightweight indexed fields only — scanning
    // the long `description` column slows the listing down as the catalog grows
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { shortDescription: { contains: q } },
            { brand: { contains: q } },
          ],
        }
      : {}),
    ...(category ? { category: { slug: category } } : {}),
    ...(tag ? { tags: { some: { tag: { slug: tag } } } } : {}),
    ...(featured === "true" ? { isFeatured: true } : {}),
    ...(priceFilter ? { price: priceFilter } : {}),
    ...(availability === "in_stock" ? { stock: { gt: 0 } } : {}),
    ...(availability === "out_of_stock" ? { stock: 0 } : {}),
  };

  let orderBy: Prisma.ProductOrderByWithRelationInput[];
  switch (sort) {
    case "newest":
      orderBy = [{ createdAt: "desc" }];
      break;
    case "price_asc":
      orderBy = [{ price: "asc" }];
      break;
    case "price_desc":
      orderBy = [{ price: "desc" }];
      break;
    case "best_selling":
      orderBy = [{ soldCount: "desc" }];
      break;
    case "rating":
      orderBy = [{ rating: "desc" }];
      break;
    case "discount":
      orderBy = [{ compareAtPrice: "desc" }, { price: "asc" }];
      break;
    default:
      orderBy = [{ isFeatured: "desc" }, { soldCount: "desc" }];
  }

  const [items, total, tags] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        price: true,
        compareAtPrice: true,
        stock: true,
        rating: true,
        reviewCount: true,
        soldCount: true,
        brand: true,
        isFeatured: true,
        createdAt: true,
        category: { select: { name: true, slug: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 2, select: { url: true, alt: true } },
        tags: { select: { tag: { select: { slug: true, name: true } } } },
      },
    }),
    db.product.count({ where }),
    db.tag.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { name: true, slug: true },
    }),
  ]);

  return ok({
    ...paginated(
      items.map((p) => ({
        ...p,
        imageUrl: p.images[0]?.url ?? null,
        hoverImageUrl: p.images[1]?.url ?? null,
        tags: p.tags.map((t) => t.tag),
      })),
      total,
      page,
      limit
    ),
    tags,
  });
}
