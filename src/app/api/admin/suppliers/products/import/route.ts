import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { importSupplierProduct } from "@/lib/suppliers/sync";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const { supplierId, supplierProductId } = body ?? {};
  if (!supplierId || !supplierProductId) return fail("supplierId and supplierProductId are required", 422);

  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return fail("Supplier not found", 404);

  try {
    const result = await importSupplierProduct(supplier, supplierProductId);
    await writeAudit(guard.admin.id, "supplier.product_imported", "supplier_product", supplierProductId, {
      product: result.product.name,
      created: result.created,
    });
    return ok({ productId: result.product.id, slug: result.product.slug, created: result.created });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Import failed", 500);
  }
}
