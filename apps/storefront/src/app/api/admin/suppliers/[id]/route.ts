import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJSON } from "@/lib/json";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("suppliers.view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      products: {
        orderBy: { updatedAt: "desc" },
        include: { product: { select: { id: true, name: true, slug: true, price: true, stock: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } } },
      },
      syncLogs: { orderBy: { createdAt: "desc" }, take: 25 },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { order: { select: { orderNumber: true, status: true, customerName: true, total: true } } },
      },
    },
  });
  if (!supplier) return fail("Supplier not found", 404);

  return ok({
    ...supplier,
    apiKey: undefined,
    apiSecret: undefined,
    hasApiKey: Boolean(supplier.apiKey),
    config: parseJSON<{ markupPercent?: number }>(supplier.config, {}),
    products: supplier.products.map((sp) => ({
      id: sp.id,
      externalId: sp.externalId,
      name: sp.name,
      price: sp.price,
      stock: sp.stock,
      sku: sp.sku,
      category: sp.category,
      images: parseJSON<string[]>(sp.images, []),
      linkedProduct: sp.product
        ? { id: sp.product.id, name: sp.product.name, slug: sp.product.slug, price: sp.product.price, stock: sp.product.stock, imageUrl: sp.product.images[0]?.url ?? null }
        : null,
      lastSyncedAt: sp.lastSyncedAt,
    })),
  });
}
