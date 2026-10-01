import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { supplierSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { stringifyJSON } from "@/lib/json";
import { AVAILABLE_ADAPTERS } from "@/lib/suppliers/registry";
import { assertSafeOutboundUrl } from "@/lib/url-guard";
import { NextResponse } from "next/server";

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

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("suppliers.view");
  if (guard instanceof NextResponse) return guard;

  const suppliers = await db.supplier.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { products: true, orders: true } },
      syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return ok({
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
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = supplierSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid supplier", 422);
  const d = parsed.data;
  if (await db.supplier.findUnique({ where: { code: d.code } })) return fail("Supplier code already exists", 409);

  let baseUrl: string | null;
  try {
    baseUrl = await checkedBaseUrl(d.baseUrl);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid base URL", 422);
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
  return ok({ ...supplier, apiKey: undefined, apiSecret: undefined, hasApiKey: Boolean(supplier.apiKey) });
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail("Supplier ID required", 422);
  const parsed = supplierSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid supplier", 422);
  const d = parsed.data;

  const existing = await db.supplier.findUnique({ where: { id } });
  if (!existing) return fail("Supplier not found", 404);

  const currentConfig = JSON.parse(existing.config ?? "{}") as { markupPercent?: number };
  let baseUrl: string | null | undefined;
  if (d.baseUrl !== undefined) {
    try {
      baseUrl = await checkedBaseUrl(d.baseUrl);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid base URL", 422);
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
  return ok({ ...supplier, apiKey: undefined, apiSecret: undefined, hasApiKey: Boolean(supplier.apiKey) });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Supplier ID required", 422);
  const count = await db.supplierOrder.count({ where: { supplierId: id } });
  if (count > 0) return fail(`Cannot delete — ${count} supplier order(s) exist. Disable the supplier instead.`, 409);
  await db.supplier.delete({ where: { id } });
  await writeAudit(guard.admin.id, "supplier.deleted", "supplier", id);
  return ok({ deleted: true });
}
