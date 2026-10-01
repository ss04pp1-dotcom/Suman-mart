import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(["activate", "deactivate", "feature", "unfeature", "delete", "setStock", "adjustPrice"]),
  value: z.number().optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return fail("Invalid bulk action payload", 422);
  const { ids, action, value } = parsed.data;

  let count = 0;
  switch (action) {
    case "activate":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: true } })).count;
      break;
    case "deactivate":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } })).count;
      break;
    case "feature":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isFeatured: true } })).count;
      break;
    case "unfeature":
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isFeatured: false } })).count;
      break;
    case "setStock":
      if (value === undefined) return fail("Stock value is required", 422);
      count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { stock: Math.max(0, Math.round(value)) } })).count;
      break;
    case "adjustPrice": {
      if (value === undefined) return fail("Price adjustment percentage is required", 422);
      const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, price: true } });
      await db.$transaction(
        products.map((p) =>
          db.product.update({
            where: { id: p.id },
            data: { price: Math.max(1, Math.round((p.price * (100 + value)) / 100)) },
          })
        )
      );
      count = products.length;
      break;
    }
    case "delete": {
      const orderItems = await db.orderItem.findMany({ where: { productId: { in: ids } }, select: { productId: true }, take: 1 });
      if (orderItems.length > 0) {
        count = (await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } })).count;
        await writeAudit(guard.admin.id, "product.bulk_archived", "product", null, { ids, reason: "some have order history" });
        return ok({ affected: count, archived: true });
      }
      count = (await db.product.deleteMany({ where: { id: { in: ids } } })).count;
      break;
    }
  }

  await writeAudit(guard.admin.id, `product.bulk_${action}`, "product", null, { ids, value });
  return ok({ affected: count });
}
