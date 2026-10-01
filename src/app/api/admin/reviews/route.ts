import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("reviews.moderate");
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const { page, limit, skip, take } = pageParams(url, 15);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();

  const where: Prisma.ReviewWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ authorName: { contains: q } }, { comment: { contains: q } }, { product: { name: { contains: q } } }] } : {}),
  };

  const [reviews, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        product: { select: { name: true, slug: true } },
        customer: { select: { name: true, email: true } },
      },
    }),
    db.review.count({ where }),
  ]);

  const counts = await db.review.groupBy({ by: ["status"], _count: true });
  return ok({ ...paginated(reviews, total, page, limit), counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("reviews.moderate");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const { id, status, isFeatured, adminReply } = body ?? {};
  if (!id) return fail("Review ID required", 422);
  if (status && !["PENDING", "APPROVED", "REJECTED", "HIDDEN"].includes(status)) return fail("Invalid status", 422);

  const review = await db.review.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(isFeatured !== undefined ? { isFeatured } : {}),
      ...(adminReply !== undefined ? { adminReply } : {}),
    },
  });

  // Recompute product rating when approval state changes
  if (status) {
    const agg = await db.review.aggregate({
      where: { productId: review.productId, status: "APPROVED" },
      _avg: { rating: true },
      _count: true,
    });
    await db.product.update({
      where: { id: review.productId },
      data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count },
    });
  }

  await writeAudit(guard.admin.id, "review.moderated", "review", id, { status });
  return ok(review);
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("reviews.moderate");
  if (guard instanceof NextResponse) return guard;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Review ID required", 422);

  const review = await db.review.findUnique({ where: { id } });
  if (!review) return fail("Review not found", 404);
  await db.review.delete({ where: { id } });

  const agg = await db.review.aggregate({ where: { productId: review.productId, status: "APPROVED" }, _avg: { rating: true }, _count: true });
  await db.product.update({
    where: { id: review.productId },
    data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count },
  });

  await writeAudit(guard.admin.id, "review.deleted", "review", id);
  return ok({ deleted: true });
}
