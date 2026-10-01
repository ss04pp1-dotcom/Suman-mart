import { db } from "@/lib/db";
import type { Supplier } from "@/generated/prisma/client";
import { parseJSON, stringifyJSON } from "@/lib/json";
import { getAdapter } from "./registry";
import { notify } from "@/lib/notifications";

// ─────────────────────────────────────────────────────────────────────────
// Product sync engine: Supplier API → SupplierProduct → (linked) Product
// ─────────────────────────────────────────────────────────────────────────

export interface SyncOutcome {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  type: "PRODUCTS" | "PRICES" | "STOCK";
  message: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  durationMs: number;
}

interface SupplierConfig {
  markupPercent?: number;
  autoCreateProducts?: boolean;
  categoryMap?: Record<string, string>;
}

function readConfig(supplier: Supplier): SupplierConfig {
  return parseJSON<SupplierConfig>(supplier.config, {});
}

function withMarkup(wholesale: number, markupPercent: number): number {
  return Math.round((wholesale * (100 + markupPercent)) / 100 / 5) * 5; // round to 5 taka
}

async function logSync(supplierId: string, outcome: SyncOutcome) {
  await db.supplierSyncLog.create({
    data: {
      supplierId,
      type: outcome.type,
      status: outcome.status,
      message: outcome.message,
      itemsProcessed: outcome.itemsProcessed,
      itemsCreated: outcome.itemsCreated,
      itemsUpdated: outcome.itemsUpdated,
      itemsFailed: outcome.itemsFailed,
      durationMs: outcome.durationMs,
    },
  });
  await db.supplier.update({ where: { id: supplierId }, data: { lastSyncAt: new Date() } });
  if (outcome.status === "FAILED" || outcome.status === "PARTIAL") {
    await notify(
      "SUPPLIER",
      `Sync ${outcome.status.toLowerCase()} for supplier`,
      outcome.message.slice(0, 200)
    );
  }
}

/** Full catalog sync: upserts SupplierProducts, applies price/stock to linked products. */
export async function syncSupplierProducts(supplier: Supplier): Promise<SyncOutcome> {
  const started = Date.now();
  const config = readConfig(supplier);
  const markup = config.markupPercent ?? 25;

  try {
    const adapter = getAdapter(supplier);
    let page = 1;
    let hasMore = true;
    let processed = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;

    while (hasMore) {
      const { products, hasMore: more } = await adapter.getProducts(page);
      hasMore = more;

      for (const feed of products) {
        processed++;
        try {
          const existing = await db.supplierProduct.findUnique({
            where: { supplierId_externalId: { supplierId: supplier.id, externalId: feed.externalId } },
            include: { product: true },
          });

          if (existing) {
            await db.supplierProduct.update({
              where: { id: existing.id },
              data: {
                name: feed.name,
                description: feed.description ?? null,
                images: stringifyJSON(feed.images),
                price: feed.price,
                stock: feed.stock,
                sku: feed.sku ?? null,
                category: feed.category ?? null,
                variants: stringifyJSON(feed.variants ?? []),
                lastSyncedAt: new Date(),
              },
            });
            if (existing.product) {
              await db.product.update({
                where: { id: existing.product.id },
                data: {
                  ...(supplier.autoSyncPrice ? { price: withMarkup(feed.price, markup) } : {}),
                  ...(supplier.autoSyncStock ? { stock: feed.stock } : {}),
                },
              });
            }
            updated++;
          } else {
            await db.supplierProduct.create({
              data: {
                supplierId: supplier.id,
                externalId: feed.externalId,
                name: feed.name,
                description: feed.description ?? null,
                images: stringifyJSON(feed.images),
                price: feed.price,
                stock: feed.stock,
                sku: feed.sku ?? null,
                category: feed.category ?? null,
                variants: stringifyJSON(feed.variants ?? []),
              },
            });
            created++;
          }
        } catch (e) {
          failed++;
          console.error(`[sync] item ${feed.externalId} failed:`, e);
        }
      }
      page++;
    }

    const outcome: SyncOutcome = {
      status: failed > 0 ? "PARTIAL" : "SUCCESS",
      type: "PRODUCTS",
      message: `Synced ${processed} items — ${created} new, ${updated} updated${failed ? `, ${failed} failed` : ""}.`,
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: failed,
      durationMs: Date.now() - started,
    };
    await logSync(supplier.id, outcome);
    return outcome;
  } catch (e) {
    const outcome: SyncOutcome = {
      status: "FAILED",
      type: "PRODUCTS",
      message: e instanceof Error ? e.message : "Unknown sync error",
      itemsProcessed: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsFailed: 0,
      durationMs: Date.now() - started,
    };
    await logSync(supplier.id, outcome);
    return outcome;
  }
}

/** Import a supplier product into the store catalog (creates a linked Product). */
export async function importSupplierProduct(supplier: Supplier, supplierProductId: string) {
  const config = readConfig(supplier);
  const markup = config.markupPercent ?? 25;
  const sp = await db.supplierProduct.findFirst({
    where: { id: supplierProductId, supplierId: supplier.id },
    include: { product: true },
  });
  if (!sp) throw new Error("Supplier product not found");
  if (sp.product) return { product: sp.product, created: false };

  // Map supplier category to a store category
  const categoryName = config.categoryMap?.[sp.category ?? ""] ?? sp.category ?? "Imported";
  let category = await db.category.findFirst({ where: { name: categoryName } });
  if (!category) {
    category = await db.category.create({
      data: {
        name: categoryName,
        slug: categoryName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      },
    });
  }

  const slug =
    sp.name
      .toLowerCase()
      .replace(/\(wholesale\)/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-") + `-${sp.externalId.toLowerCase()}`;

  const images = parseJSON<string[]>(sp.images, []);
  const variants = parseJSON<{ group: string; options: string[] }[]>(sp.variants, []);

  const product = await db.product.create({
    data: {
      name: sp.name.replace(/\s*\(Wholesale\)\s*/i, "").trim(),
      slug,
      shortDescription: sp.description?.slice(0, 140) ?? null,
      description: sp.description,
      price: withMarkup(sp.price, markup),
      compareAtPrice: withMarkup(Math.round(sp.price * 1.45), markup - 25 > 0 ? markup : 0),
      costPrice: sp.price,
      sku: sp.sku ?? `IMP-${sp.externalId}`,
      stock: sp.stock,
      categoryId: category.id,
      images: {
        create: images.map((url, i) => ({ url, alt: sp.name, sortOrder: i })),
      },
      variants: variants.length
        ? {
            create: variants.flatMap((v) =>
              v.options.map((opt, i) => ({
                name: v.group,
                options: stringifyJSON({ [v.group]: opt }),
                sortOrder: i,
              }))
            ),
          }
        : undefined,
    },
  });

  await db.supplierProduct.update({
    where: { id: sp.id },
    data: { productId: product.id, lastSyncedAt: new Date() },
  });

  return { product, created: true };
}

/** Quick price/stock refresh for already-linked products only. */
export async function syncSupplierPricesAndStock(supplier: Supplier, type: "PRICES" | "STOCK"): Promise<SyncOutcome> {
  const started = Date.now();
  const config = readConfig(supplier);
  const markup = config.markupPercent ?? 25;

  try {
    const adapter = getAdapter(supplier);
    const links = await db.supplierProduct.findMany({
      where: { supplierId: supplier.id, productId: { not: null } },
      include: { product: true },
    });

    let processed = 0;
    let updated = 0;
    let failed = 0;

    for (const link of links) {
      processed++;
      try {
        if (type === "STOCK") {
          const stockMap = await adapter.getStock([link.externalId]);
          const stock = stockMap[link.externalId] ?? link.stock;
          await db.supplierProduct.update({ where: { id: link.id }, data: { stock } });
          if (supplier.autoSyncStock && link.product) {
            await db.product.update({ where: { id: link.product.id }, data: { stock } });
          }
        } else {
          const feed = await adapter.getProduct(link.externalId);
          if (feed) {
            await db.supplierProduct.update({ where: { id: link.id }, data: { price: feed.price } });
            if (supplier.autoSyncPrice && link.product) {
              await db.product.update({
                where: { id: link.product.id },
                data: { price: withMarkup(feed.price, markup) },
              });
            }
          }
        }
        updated++;
      } catch {
        failed++;
      }
    }

    const outcome: SyncOutcome = {
      status: failed > 0 ? "PARTIAL" : "SUCCESS",
      type,
      message: `${type === "PRICES" ? "Prices" : "Stock"} refreshed for ${processed} linked items — ${updated} updated${failed ? `, ${failed} failed` : ""}.`,
      itemsProcessed: processed,
      itemsCreated: 0,
      itemsUpdated: updated,
      itemsFailed: failed,
      durationMs: Date.now() - started,
    };
    await logSync(supplier.id, outcome);
    return outcome;
  } catch (e) {
    const outcome: SyncOutcome = {
      status: "FAILED",
      type,
      message: e instanceof Error ? e.message : "Unknown sync error",
      itemsProcessed: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsFailed: 0,
      durationMs: Date.now() - started,
    };
    await logSync(supplier.id, outcome);
    return outcome;
  }
}
