import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { refreshSupplierOrder, cancelSupplierOrder } from "@/lib/suppliers/orders";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("suppliers.manage");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string })?.action;
  if (action !== "refresh" && action !== "cancel") return fail("Unknown action", 422);

  try {
    if (action === "refresh") {
      const result = await refreshSupplierOrder(id);
      return ok(result);
    }
    const result = await cancelSupplierOrder(id);
    await writeAudit(guard.admin.id, "supplier.order_cancelled", "supplier_order", id, { ok: result.ok });
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Action failed", 500);
  }
}
