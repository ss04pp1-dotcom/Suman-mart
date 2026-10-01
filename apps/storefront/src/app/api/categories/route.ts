import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/api";

export async function GET(_req: NextRequest) {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
  return ok(categories.map((c) => ({ ...c, productCount: c._count.products, _count: undefined })));
}
