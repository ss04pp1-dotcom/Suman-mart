// Storefront server-rendered-page endpoints — Phase 9.
//
// The storefront's React Server Components used to read Prisma directly;
// after the flip they fetch the shared Workers API (same authoritative D1).
// These endpoints return the EXACT data shapes those pages consumed, so the
// page rendering code is unchanged — only the data source moved.
//
// Public: /layout, /home, /product/:slug, /order-success/:orderNumber, /sitemap
// Session-authenticated (cookie forwarded by the storefront proxy):
//   /account/overview, /account/orders, /account/order/:orderNumber

import { Hono } from "hono";
import type { Env } from "../env";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getCustomerSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const storefrontApi = new Hono<{ Bindings: Env }>();

// GET /v1/storefront/layout — header categories + store identity
storefrontApi.get("/layout", async (c) => {
  const [categories, general, seo] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, slug: true },
    }),
    getSetting("general"),
    getSetting("seo"),
  ]);
  return ok(c, { categories, general, seo });
});

// GET /v1/storefront/home — homepage bundle (one round-trip)
storefrontApi.get("/home", async (c) => {
  const now = new Date();
  const activeBanner = { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] };

  const [banners, sections, categories, featured, newArrivals, bestSellers, specialOffers, topReviews, promoBanner] =
    await Promise.all([
      db.banner.findMany({
        where: { placement: "HERO", ...activeBanner },
        orderBy: { sortOrder: "asc" },
      }),
      db.homepageSection.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      db.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { products: { where: { isActive: true } } } } },
      }),
      db.product.findMany({
        where: { isActive: true, isFeatured: true },
        orderBy: { soldCount: "desc" },
        take: 8,
        include: { images: { orderBy: { sortOrder: "asc" }, take: 2 }, category: { select: { name: true, slug: true } } },
      }),
      db.product.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { images: { orderBy: { sortOrder: "asc" }, take: 2 }, category: { select: { name: true, slug: true } } },
      }),
      db.product.findMany({
        where: { isActive: true, stock: { gt: 0 } },
        orderBy: { soldCount: "desc" },
        take: 8,
        include: { images: { orderBy: { sortOrder: "asc" }, take: 2 }, category: { select: { name: true, slug: true } } },
      }),
      db.product.findMany({
        where: { isActive: true, compareAtPrice: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 4,
        include: { images: { orderBy: { sortOrder: "asc" }, take: 2 }, category: { select: { name: true, slug: true } } },
      }),
      db.review.findMany({
        where: { status: "APPROVED", isFeatured: true, rating: { gte: 4 } },
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { product: { select: { name: true, slug: true } } },
      }),
      db.banner.findFirst({ where: { placement: "PROMO", ...activeBanner }, orderBy: { sortOrder: "asc" } }),
    ]);

  return ok(c, { banners, sections, categories, featured, newArrivals, bestSellers, specialOffers, topReviews, promoBanner });
});

// GET /v1/storefront/product/:slug — product detail bundle
storefrontApi.get("/product/:slug", async (c) => {
  const slug = c.req.param("slug");

  const [product, shipping] = await Promise.all([
    db.product.findFirst({
      where: { slug, isActive: true },
      include: {
        category: { select: { name: true, slug: true } },
        images: { orderBy: { sortOrder: "asc" } },
        variants: { orderBy: { sortOrder: "asc" } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
        reviews: { where: { status: "APPROVED" }, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }], take: 10, select: { id: true, authorName: true, rating: true, title: true, comment: true, adminReply: true, verifiedPurchase: true, isFeatured: true, createdAt: true } },
      },
    }),
    getSetting("shipping"),
  ]);
  if (!product) return fail(c, "Product not found", 404, "NOT_FOUND");

  const [relations, fbt, autoRelated] = await Promise.all([
    db.productRelation.findMany({
      where: { productId: product.id, type: "RELATED" },
      orderBy: { sortOrder: "asc" },
      include: { relatedProduct: { include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true, slug: true } } } } },
      take: 4,
    }),
    db.productRelation.findMany({
      where: { productId: product.id, type: "FBT" },
      orderBy: { sortOrder: "asc" },
      include: { relatedProduct: { include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true, slug: true } } } } },
      take: 3,
    }),
    db.product.findMany({
      where: { isActive: true, id: { not: product.id }, categoryId: product.categoryId },
      orderBy: { soldCount: "desc" },
      take: 4,
      include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true, slug: true } } },
    }),
  ]);

  // SEO metadata payload (generateMetadata parity)
  const seo = {
    name: product.name,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    shortDescription: product.shortDescription,
    firstImage: product.images[0]?.url ?? null,
  };

  return ok(c, { product, shipping, relations, fbt, autoRelated, seo });
});

// GET /v1/storefront/order-success/:orderNumber — guest-accessible receipt
// (the order number itself is the capability, same as the monolith page)
storefrontApi.get("/order-success/:orderNumber", async (c) => {
  const orderNumber = c.req.param("orderNumber").toUpperCase();
  const order = await db.order.findUnique({
    where: { orderNumber },
    include: { items: true },
  });
  if (!order) return fail(c, "Order not found", 404, "NOT_FOUND");
  return ok(c, { order });
});

// GET /v1/storefront/sitemap — URLs for sitemap.xml
storefrontApi.get("/sitemap", async (c) => {
  const [products, categories] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ where: { isActive: true }, select: { slug: true } }),
  ]);
  return ok(c, { products, categories });
});

// ── Authenticated account pages ─────────────────────────────────────

// GET /v1/storefront/account/overview — profile page stats
storefrontApi.get("/account/overview", async (c) => {
  const session = await getCustomerSession(c.req.raw);
  if (!session) return fail(c, "Authentication required", 401);

  const [customer, orderCount, spent, activeOrders, addressCount] = await Promise.all([
    db.customer.findUnique({
      where: { id: session.id },
      select: { id: true, name: true, email: true, phone: true, avatarUrl: true, createdAt: true, emailVerifiedAt: true, addresses: true },
    }),
    db.order.count({ where: { customerId: session.id, status: { not: "CANCELLED" } } }),
    db.order.aggregate({ where: { customerId: session.id, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    db.order.count({ where: { customerId: session.id, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] } } }),
    db.address.count({ where: { customerId: session.id } }),
  ]);
  if (!customer) return fail(c, "Account not found", 404);

  return ok(c, {
    customer,
    stats: {
      orderCount,
      totalSpent: spent._sum.total ?? 0,
      activeOrders,
      addressCount,
    },
  });
});

// GET /v1/storefront/account/orders — order history page
storefrontApi.get("/account/orders", async (c) => {
  const session = await getCustomerSession(c.req.raw);
  if (!session) return fail(c, "Authentication required", 401);

  const orders = await db.order.findMany({
    where: { customerId: session.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { items: true },
  });
  return ok(c, { orders });
});

// GET /v1/storefront/account/order/:orderNumber — one owned order
storefrontApi.get("/account/order/:orderNumber", async (c) => {
  const session = await getCustomerSession(c.req.raw);
  if (!session) return fail(c, "Authentication required", 401);

  const order = await db.order.findFirst({
    where: { customerId: session.id, orderNumber: c.req.param("orderNumber").toUpperCase() },
    include: {
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      supplierOrders: { include: { supplier: { select: { name: true } } } },
    },
  });
  if (!order) return fail(c, "Order not found", 404, "NOT_FOUND");
  return ok(c, { order });
});
