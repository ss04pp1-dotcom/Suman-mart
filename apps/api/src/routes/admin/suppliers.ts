// Admin supplier management — Hono port of
// apps/storefront/src/app/api/admin/suppliers/* (list/detail, sync, import,
// supplier order actions).

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { supplierSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { stringifyJSON, parseJSON } from "@/lib/json";
import { AVAILABLE_ADAPTERS } from "@/lib/suppliers/registry";
import { assertSafeOutboundUrl } from "@/lib/url-guard";
import { syncSupplierProducts, syncSupplierPricesAndStock, importSupplierProduct } from "@/lib/suppliers/sync";
import { refreshSupplierOrder, cancelSupplierOrder } from "@/lib/suppliers/orders";
import { z } from "zod";

export const adminSuppliersApi = new Hono<{ Bindings: Env }>();

/** SSRF guard — supplier base URLs must be public https endpoints. */
async function checkedBaseUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const checked = await assertSafeOutboundUrl(url);
    return checked.toString();
  } catch {
    throw new Error("Base URL must be a public https endpoint (private/local addresses are blocked)");
  }
}

// GET /v1/admin/suppliers — list + available adapters
adminSuppliersApi.get("/", async (c) => {
  await requireAdmin(c, "suppliers.view");

  const suppliers = await db.supplier.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { products: true, orders: true } },
      syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return ok(c, {
    suppliers: suppliers.map((s) => ({
      id: s.id, name: s.name, code: s.code, email: s.email, phone: s.phone, adapter: s.adapter,
      baseUrl: s.baseUrl, autoSyncPrice: s.autoSyncPrice, autoSyncStock: s.autoSyncStock,
      isActive: s.isActive, notes: s.notes, lastSyncAt: s.lastSyncAt, createdAt: s.createdAt,
      hasApiKey: Boolean(s.apiKey),
      productCount: s._count.products,
      orderCount: s._count.orders,
      lastSync: s.syncLogs[0] ?? null,
    })),
    adapters: AVAILABLE_ADAPTERS,
  });
});

// POST /v1/admin/suppliers — create
adminSuppliersApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = supplierSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid supplier", 422);
  const d = parsed.data;
  if (await db.supplier.findUnique({ where: { code: d.code } })) return fail(c, "Supplier code already exists", 409);

  let baseUrl: string | null;
  try {
    baseUrl = await checkedBaseUrl(d.baseUrl);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Invalid base URL", 422);
  }

  const supplier = await db.supplier.create({
    data: {
      name: d.name, code: d.code, email: d.email || null, phone: d.phone || null,
      adapter: d.adapter, baseUrl,
      apiKey: d.apiKey || null, apiSecret: d.apiSecret || null,
      autoSyncPrice: d.autoSyncPrice ?? true, autoSyncStock: d.autoSyncStock ?? true,
      config: stringifyJSON({ markupPercent: d.markupPercent ?? 25 }),
      isActive: d.isActive ?? true, notes: d.notes || null,
    },
  });
  await writeAudit(guard.admin.id, "supplier.created", "supplier", supplier.id, { name: supplier.name });
  return ok(c, { ...supplier, apiKey: undefined, apiSecret: undefined, hasApiKey: Boolean(supplier.apiKey) });
});

// PUT /v1/admin/suppliers — update
adminSuppliersApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");

  const body = await c.req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail(c, "Supplier ID required", 422);
  const parsed = supplierSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid supplier", 422);
  const d = parsed.data;

  const existing = await db.supplier.findUnique({ where: { id } });
  if (!existing) return fail(c, "Supplier not found", 404);

  const currentConfig = JSON.parse(existing.config ?? "{}") as { markupPercent?: number };
  let baseUrl: string | null | undefined;
  if (d.baseUrl !== undefined) {
    try {
      baseUrl = await checkedBaseUrl(d.baseUrl);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Invalid base URL", 422);
    }
  }
  const supplier = await db.supplier.update({
    where: { id },
    data: {
      ...(d.name ? { name: d.name } : {}),
      ...(d.email !== undefined ? { email: d.email || null } : {}),
      ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
      ...(d.adapter ? { adapter: d.adapter } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      // Blank credentials mean "keep existing"
      ...(d.apiKey ? { apiKey: d.apiKey } : {}),
      ...(d.apiSecret ? { apiSecret: d.apiSecret } : {}),
      ...(d.autoSyncPrice !== undefined ? { autoSyncPrice: d.autoSyncPrice } : {}),
      ...(d.autoSyncStock !== undefined ? { autoSyncStock: d.autoSyncStock } : {}),
      ...(d.markupPercent !== undefined ? { config: stringifyJSON({ ...currentConfig, markupPercent: d.markupPercent }) } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
    },
  });
  await writeAudit(guard.admin.id, "supplier.updated", "supplier", id, { name: supplier.name });
  return ok(c, { ...supplier, apiKey: undefined, apiSecret: undefined, hasApiKey: Boolean(supplier.apiKey) });
});

// DELETE /v1/admin/suppliers?id=…
adminSuppliersApi.delete("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");
  const id = new URL(c.req.url).searchParams.get("id");
  if (!id) return fail(c, "Supplier ID required", 422);
  const count = await db.supplierOrder.count({ where: { supplierId: id } });
  if (count > 0) return fail(c, `Cannot delete — ${count} supplier order(s) exist. Disable the supplier instead.`, 409);
  await db.supplier.delete({ where: { id } });
  await writeAudit(guard.admin.id, "supplier.deleted", "supplier", id);
  return ok(c, { deleted: true });
});

// GET /v1/admin/suppliers/:id — detail (mappings, sync logs, supplier orders)
adminSuppliersApi.get("/:id", async (c) => {
  await requireAdmin(c, "suppliers.view");
  const id = c.req.param("id");

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
  if (!supplier) return fail(c, "Supplier not found", 404);

  return ok(c, {
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
});

// POST /v1/admin/suppliers/:id/sync — run a sync now
adminSuppliersApi.post("/:id/sync", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ type: z.enum(["PRODUCTS", "PRICES", "STOCK"]).default("PRODUCTS") }).safeParse(body);
  if (!parsed.success) return fail(c, "Invalid sync type", 422);

  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) return fail(c, "Supplier not found", 404);
  if (!supplier.isActive) return fail(c, "Supplier is disabled", 409);

  const outcome =
    parsed.data.type === "PRODUCTS"
      ? await syncSupplierProducts(supplier)
      : await syncSupplierPricesAndStock(supplier, parsed.data.type);

  await writeAudit(guard.admin.id, "supplier.sync", "supplier", id, { type: parsed.data.type, status: outcome.status });
  return ok(c, outcome);
});

// POST /v1/admin/suppliers/products/import — import one supplier product
adminSuppliersApi.post("/products/import", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");

  const body = await c.req.json().catch(() => null);
  const { supplierId, supplierProductId } = body ?? {};
  if (!supplierId || !supplierProductId) return fail(c, "supplierId and supplierProductId are required", 422);

  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return fail(c, "Supplier not found", 404);

  try {
    const result = await importSupplierProduct(supplier, supplierProductId);
    await writeAudit(guard.admin.id, "supplier.product_imported", "supplier_product", supplierProductId, {
      product: result.product.name,
      created: result.created,
    });
    return ok(c, { productId: result.product.id, slug: result.product.slug, created: result.created });
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Import failed", 500);
  }
});

// POST /v1/admin/suppliers/orders/:id — refresh or cancel a supplier order
adminSuppliersApi.post("/orders/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "suppliers.manage");
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const action = (body as { action?: string })?.action;
  if (action !== "refresh" && action !== "cancel") return fail(c, "Unknown action", 422);

  try {
    if (action === "refresh") {
      const result = await refreshSupplierOrder(id);
      return ok(c, result);
    }
    const result = await cancelSupplierOrder(id);
    await writeAudit(guard.admin.id, "supplier.order_cancelled", "supplier_order", id, { ok: result.ok });
    return ok(c, result);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Action failed", 500);
  }
});
