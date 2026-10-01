// Admin catalog CRUD — Hono port of apps/storefront/src/app/api/admin/
// {categories,coupons,banners,reviews}/route.ts.

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { categorySchema, couponSchema, bannerSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";

// ── Categories ─────────────────────────────────────────────────────

export const adminCategoriesApi = new Hono<{ Bindings: Env }>();

adminCategoriesApi.get("/", async (c) => {
  await requireAdmin(c, "products.view");
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return ok(c, categories.map((cat) => ({ ...cat, productCount: cat._count.products })));
});

adminCategoriesApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");
  const body = await c.req.json().catch(() => null);
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid category", 422);

  const slug = slugify(parsed.data.name);
  if (await db.category.findUnique({ where: { slug } })) return fail(c, "Category already exists", 409);

  const category = await db.category.create({
    data: { ...parsed.data, slug, imageUrl: parsed.data.imageUrl || null },
  });
  await writeAudit(guard.admin.id, "category.created", "category", category.id, { name: category.name });
  return ok(c, category);
});

adminCategoriesApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");
  const body = await c.req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail(c, "Category ID required", 422);
  const parsed = categorySchema.partial().safeParse(rest);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid category", 422);

  const category = await db.category.update({ where: { id }, data: parsed.data });
  await writeAudit(guard.admin.id, "category.updated", "category", id, { name: category.name });
  return ok(c, category);
});

adminCategoriesApi.delete("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "products.manage");
  const id = new URL(c.req.url).searchParams.get("id");
  if (!id) return fail(c, "Category ID required", 422);

  const count = await db.product.count({ where: { categoryId: id } });
  if (count > 0) return fail(c, `Cannot delete — ${count} product(s) use this category`, 409);

  await db.category.delete({ where: { id } });
  await writeAudit(guard.admin.id, "category.deleted", "category", id);
  return ok(c, { deleted: true });
});

// ── Coupons ────────────────────────────────────────────────────────

export const adminCouponsApi = new Hono<{ Bindings: Env }>();

adminCouponsApi.get("/", async (c) => {
  await requireAdmin(c, "coupons.manage");
  const coupons = await db.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true } }, category: { select: { name: true } }, customer: { select: { name: true } } },
  });
  return ok(c, coupons);
});

adminCouponsApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "coupons.manage");
  const body = await c.req.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid coupon", 422);
  if (await db.coupon.findUnique({ where: { code: parsed.data.code } })) return fail(c, "Coupon code already exists", 409);
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
  return ok(c, coupon);
});

adminCouponsApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "coupons.manage");
  const body = await c.req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail(c, "Coupon ID required", 422);
  const parsed = couponSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid coupon", 422);
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
  return ok(c, coupon);
});

adminCouponsApi.delete("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "coupons.manage");
  const id = new URL(c.req.url).searchParams.get("id");
  if (!id) return fail(c, "Coupon ID required", 422);
  await db.coupon.delete({ where: { id } });
  await writeAudit(guard.admin.id, "coupon.deleted", "coupon", id);
  return ok(c, { deleted: true });
});

// ── Banners + homepage sections ────────────────────────────────────

export const adminBannersApi = new Hono<{ Bindings: Env }>();

adminBannersApi.get("/", async (c) => {
  await requireAdmin(c, "banners.manage");
  const banners = await db.banner.findMany({ orderBy: [{ placement: "asc" }, { sortOrder: "asc" }] });
  const sections = await db.homepageSection.findMany({ orderBy: { sortOrder: "asc" } });
  return ok(c, { banners, sections });
});

adminBannersApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "banners.manage");
  const body = await c.req.json().catch(() => null);
  const parsed = bannerSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid banner", 422);
  const d = parsed.data;
  const banner = await db.banner.create({
    data: {
      title: d.title, subtitle: d.subtitle ?? null, imageUrl: d.imageUrl,
      buttonLabel: d.buttonLabel ?? null, buttonUrl: d.buttonUrl ?? null,
      placement: d.placement, theme: d.theme ?? "Dark", sortOrder: d.sortOrder ?? 0,
      startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
      endsAt: d.endsAt ? new Date(d.endsAt) : null,
      isActive: d.isActive ?? true,
    },
  });
  await writeAudit(guard.admin.id, "banner.created", "banner", banner.id, { title: banner.title });
  return ok(c, banner);
});

adminBannersApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "banners.manage");
  const body = await c.req.json().catch(() => null);
  const { id, sectionId, ...rest } = body ?? {};

  // Homepage section toggling
  if (sectionId) {
    const section = await db.homepageSection.update({
      where: { key: sectionId },
      data: { isActive: rest.isActive },
    });
    await writeAudit(guard.admin.id, "homepage_section.updated", "homepage_section", sectionId, { isActive: rest.isActive });
    return ok(c, section);
  }

  if (!id) return fail(c, "Banner ID required", 422);
  const parsed = bannerSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid banner", 422);
  const d = parsed.data;
  const banner = await db.banner.update({
    where: { id },
    data: {
      ...(d.title ? { title: d.title } : {}),
      ...(d.subtitle !== undefined ? { subtitle: d.subtitle } : {}),
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
      ...(d.buttonLabel !== undefined ? { buttonLabel: d.buttonLabel } : {}),
      ...(d.buttonUrl !== undefined ? { buttonUrl: d.buttonUrl } : {}),
      ...(d.placement ? { placement: d.placement } : {}),
      ...(d.theme ? { theme: d.theme } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...(d.startsAt ? { startsAt: new Date(d.startsAt) } : {}),
      ...(d.endsAt !== undefined ? { endsAt: d.endsAt ? new Date(d.endsAt) : null } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });
  await writeAudit(guard.admin.id, "banner.updated", "banner", id, { title: banner.title });
  return ok(c, banner);
});

adminBannersApi.delete("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "banners.manage");
  const id = new URL(c.req.url).searchParams.get("id");
  if (!id) return fail(c, "Banner ID required", 422);
  await db.banner.delete({ where: { id } });
  await writeAudit(guard.admin.id, "banner.deleted", "banner", id);
  return ok(c, { deleted: true });
});

// ── Review moderation ──────────────────────────────────────────────

export const adminReviewsApi = new Hono<{ Bindings: Env }>();

adminReviewsApi.get("/", async (c) => {
  await requireAdmin(c, "reviews.moderate");

  const url = new URL(c.req.url);
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
  return ok(c, { ...paginated(reviews, total, page, limit), counts: Object.fromEntries(counts.map((cnt) => [cnt.status, cnt._count])) });
});

adminReviewsApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "reviews.moderate");

  const body = await c.req.json().catch(() => null);
  const { id, status, isFeatured, adminReply } = body ?? {};
  if (!id) return fail(c, "Review ID required", 422);
  if (status && !["PENDING", "APPROVED", "REJECTED", "HIDDEN"].includes(status)) return fail(c, "Invalid status", 422);

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
  return ok(c, review);
});

adminReviewsApi.delete("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "reviews.moderate");
  const id = new URL(c.req.url).searchParams.get("id");
  if (!id) return fail(c, "Review ID required", 422);

  const review = await db.review.findUnique({ where: { id } });
  if (!review) return fail(c, "Review not found", 404);
  await db.review.delete({ where: { id } });

  const agg = await db.review.aggregate({ where: { productId: review.productId, status: "APPROVED" }, _avg: { rating: true }, _count: true });
  await db.product.update({
    where: { id: review.productId },
    data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count },
  });

  await writeAudit(guard.admin.id, "review.deleted", "review", id);
  return ok(c, { deleted: true });
});
