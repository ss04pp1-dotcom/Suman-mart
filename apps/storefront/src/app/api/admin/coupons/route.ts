import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { couponSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("coupons.manage");
  if (guard instanceof NextResponse) return guard;
  const coupons = await db.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true } }, category: { select: { name: true } }, customer: { select: { name: true } } },
  });
  return ok(coupons);
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("coupons.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid coupon", 422);
  if (await db.coupon.findUnique({ where: { code: parsed.data.code } })) return fail("Coupon code already exists", 409);
  const d = parsed.data;
  const coupon = await db.coupon.create({
    data: {
      code: d.code,
      type: d.type,
      value: d.value ?? 0,
      minOrderAmount: d.minOrderAmount ?? null,
      maxDiscount: d.maxDiscount ?? null,
      startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      usageLimit: d.usageLimit ?? null,
      perCustomerLimit: d.perCustomerLimit ?? null,
      productId: d.productId || null,
      categoryId: d.categoryId || null,
      customerId: d.customerId || null,
      isActive: d.isActive ?? true,
    },
  });
  await writeAudit(guard.admin.id, "coupon.created", "coupon", coupon.id, { code: coupon.code });
  return ok(coupon);
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("coupons.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail("Coupon ID required", 422);
  const parsed = couponSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid coupon", 422);
  const d = parsed.data;
  const coupon = await db.coupon.update({
    where: { id },
    data: {
      ...(d.type ? { type: d.type } : {}),
      ...(d.value !== undefined ? { value: d.value } : {}),
      ...(d.minOrderAmount !== undefined ? { minOrderAmount: d.minOrderAmount } : {}),
      ...(d.maxDiscount !== undefined ? { maxDiscount: d.maxDiscount } : {}),
      ...(d.startsAt ? { startsAt: new Date(d.startsAt) } : {}),
      ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt ? new Date(d.expiresAt) : null } : {}),
      ...(d.usageLimit !== undefined ? { usageLimit: d.usageLimit } : {}),
      ...(d.perCustomerLimit !== undefined ? { perCustomerLimit: d.perCustomerLimit } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });
  await writeAudit(guard.admin.id, "coupon.updated", "coupon", id, { code: coupon.code });
  return ok(coupon);
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("coupons.manage");
  if (guard instanceof NextResponse) return guard;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Coupon ID required", 422);
  await db.coupon.delete({ where: { id } });
  await writeAudit(guard.admin.id, "coupon.deleted", "coupon", id);
  return ok({ deleted: true });
}
