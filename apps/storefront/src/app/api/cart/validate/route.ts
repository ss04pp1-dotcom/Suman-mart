import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { validateCart, validateCoupon, type CouponResult } from "@/lib/checkout";
import { getSetting } from "@/lib/settings";
import { getCustomerSession } from "@/lib/auth";
import { cartItemSchema } from "@/lib/validators";
import { z } from "zod";

const schema = z.object({
  items: z.array(cartItemSchema),
  couponCode: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Invalid cart payload", 422);

  const { items, couponCode } = parsed.data;
  const session = await getCustomerSession();
  const customer = session
    ? await (await import("@/lib/db")).db.customer.findUnique({ where: { id: session.id } })
    : null;

  const { lines, errors } = await validateCart(items);
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);

  let couponResult: CouponResult | null = null;
  if (couponCode && lines.length > 0) {
    couponResult = await validateCoupon(couponCode, subtotal, lines, {
      customerId: customer?.id ?? null,
      email: customer?.email ?? null,
      // phone identity is applied at order time from the shipping address
    });
  }

  const shippingSettings = await getSetting("shipping");
  const discount = couponResult?.ok ? couponResult.discount : 0;
  const freeShipping =
    couponResult?.ok && couponResult.freeShipping ||
    (shippingSettings.freeShippingThreshold > 0 && subtotal - discount >= shippingSettings.freeShippingThreshold);
  const shippingTotal = lines.length === 0 || freeShipping ? 0 : shippingSettings.flatRate;
  const total = subtotal - discount + shippingTotal;

  return ok({
    lines: lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      imageUrl: l.imageUrl,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      total: l.total,
      options: l.options,
      stock: l.stock,
    })),
    errors,
    coupon: couponResult
      ? { ok: couponResult.ok, reason: couponResult.reason ?? null, code: couponResult.coupon?.code ?? null, discount: couponResult.discount, freeShipping: couponResult.freeShipping, type: couponResult.coupon?.type ?? null }
      : null,
    totals: { subtotal, discount, shippingTotal, codCharge: shippingSettings.codCharge, total, freeShipping },
  });
}
