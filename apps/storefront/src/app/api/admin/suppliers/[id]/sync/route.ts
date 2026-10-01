import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { syncSupplierProducts, syncSupplierPricesAndStock } from "@/lib/suppliers/sync";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ type: z.enum(["PRODUCTS", "PRICES", "STOCK"]).default("PRODUCTS") }).safeParse(body);
  if (!parsed.success) return fail("Invalid sync type", 422);

  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) return fail("Supplier not found", 404);
  if (!supplier.isActive) return fail("Supplier is disabled", 409);

  const outcome =
    parsed.data.type === "PRODUCTS"
      ? await syncSupplierProducts(supplier)
      : await syncSupplierPricesAndStock(supplier, parsed.data.type);

  await writeAudit(guard.admin.id, "supplier.sync", "supplier", id, { type: parsed.data.type, status: outcome.status });
  return ok(outcome);
}
