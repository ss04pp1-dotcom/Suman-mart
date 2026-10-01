import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { maybeRunRetention } from "@/lib/tracking";
import { retryFailedSupplierOrders } from "@/lib/suppliers/orders";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

const schema = z.object({
  action: z.enum(["retention", "retry-supplier-orders"]),
});

/**
 * Operator maintenance actions (super-admin only):
 *  • retention — force-prune tracking events/sessions older than 180 days
 *  • retry-supplier-orders — re-run failed supplier placements
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("settings.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid action", 422);

  if (parsed.data.action === "retention") {
    const result = await maybeRunRetention(true);
    await writeAudit(guard.admin.id, "maintenance.retention", "maintenance", "tracking", { ...result });
    return ok(result);
  }

  const result = await retryFailedSupplierOrders();
  await writeAudit(guard.admin.id, "maintenance.supplier_retry", "maintenance", "supplier_orders", { ...result });
  return ok(result);
}
