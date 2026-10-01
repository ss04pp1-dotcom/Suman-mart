// Product review submission — Hono port of
// apps/storefront/src/app/api/reviews/route.ts.

import { Hono } from "hono";
import type { Env } from "../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { reviewSchema } from "@/lib/validators";
import { getCustomerSession } from "@/lib/auth";
import { ipRateLimit } from "@/lib/rate-limit";
import { reviewVerificationEnforced } from "@/lib/email-gate";
import { notify } from "@/lib/notifications";
import { getSetting } from "@/lib/settings";

export const reviewsApi = new Hono<{ Bindings: Env }>();

// POST /v1/reviews
reviewsApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("review", 5, 10 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many review submissions. Please try again later.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid review", 422);

  const product = await db.product.findFirst({ where: { id: parsed.data.productId, isActive: true } });
  if (!product) return fail(c, "Product not found", 404);

  const session = await getCustomerSession(c.req.raw);
  let authorName = parsed.data.authorName;
  let verifiedPurchase = false;

  if (session) {
    // Signed-in customers: one review per product, verified email required,
    // and they must actually have bought the product (delivered order).
    const existing = await db.review.findFirst({ where: { productId: product.id, customerId: session.id } });
    if (existing) return fail(c, "You have already reviewed this product", 409);

    const customer = await db.customer.findUnique({
      where: { id: session.id },
      select: { name: true, emailVerifiedAt: true },
    });
    // Verification is only required when a mail provider is configured —
    // without one, verification is impossible and the gate would just
    // deadlock honest reviewers (see src/lib/email-gate.ts).
    if (!customer) return fail(c, "Account not found", 404);
    if (reviewVerificationEnforced() && !customer.emailVerifiedAt) {
      return fail(c, "Verify your email before writing a review — resend the link from Account → Security", 403, "EMAIL_NOT_VERIFIED");
    }

    const purchase = await db.orderItem.findFirst({
      where: {
        productId: product.id,
        order: { customerId: session.id, status: "DELIVERED" },
      },
      select: { id: true },
    });
    if (!purchase) {
      return fail(c, "You can review this product after your order is delivered", 403);
    }
    verifiedPurchase = true;

    authorName = customer.name ?? authorName;
    if (!authorName) return fail(c, "Your name is required", 422);
  } else if (!authorName) {
    return fail(c, "Your name is required", 422);
  }

  const review = await db.review.create({
    data: {
      productId: product.id,
      customerId: session?.id ?? null,
      authorName: authorName!,
      rating: parsed.data.rating,
      title: parsed.data.title ?? null,
      comment: parsed.data.comment,
      verifiedPurchase,
      status: "PENDING",
    },
  });

  const settings = await getSetting("notifications");
  if (settings.reviewAlerts) {
    await notify("REVIEW", `New review for ${product.name}`, `${authorName} left a ${parsed.data.rating}-star review. It is awaiting moderation.`, "/admin/reviews");
  }

  return ok(c, { id: review.id, status: review.status, verifiedPurchase });
});
