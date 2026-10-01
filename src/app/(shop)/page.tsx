import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { ProductCard } from "@/components/shop/product-card";
import { HeroCarousel } from "@/components/shop/hero-carousel";
import { RatingStars } from "@/components/shop/product-card";
import { SectionHeading } from "@/components/shop/section-heading";
import { Button } from "@/components/ui/button";
import {
  BadgeCheck,
  CreditCard,
  Headphones,
  Package,
  ShieldCheck,
  Truck,
  ChevronRight,
  Quote,
} from "lucide-react";

// Server component — data is read directly from the database
export default async function HomePage() {
  const now = new Date();
  const activeBanner = { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] };

  const [banners, sections, categories, featured, newArrivals, bestSellers, specialOffers, topReviews, sectionMeta] =
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
      db.homepageSection.findMany(),
    ]);
  void sectionMeta;

  const toCard = (p: (typeof featured)[number]) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    rating: p.rating,
    reviewCount: p.reviewCount,
    stock: p.stock,
    soldCount: p.soldCount,
    brand: p.brand,
    imageUrl: p.images[0]?.url ?? null,
    category: p.category,
  });

  const has = (key: string) => sections.some((s) => s.key === key);
  const meta = (key: string) => sections.find((s) => s.key === key);

  const promoBanner = await db.banner.findFirst({
    where: { placement: "PROMO", ...activeBanner },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-14 px-4 py-6 sm:py-8">
      {has("hero") || banners.length > 0 ? <HeroCarousel banners={banners} /> : null}

      {has("categories") && (
        <section aria-label="Shop by category">
          <SectionHeading
            title={meta("categories")?.title ?? "Shop by Category"}
            subtitle={meta("categories")?.subtitle ?? undefined}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-8">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/products?category=${c.slug}`}
                className="group flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="relative h-16 w-16 overflow-hidden rounded-full sm:h-20 sm:w-20">
                  {c.imageUrl && (
                    <Image
                      src={c.imageUrl}
                      alt={c.name}
                      fill
                      sizes="80px"
                      className="object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight group-hover:text-brand-700 dark:group-hover:text-brand-600">
                    {c.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{c._count.products} items</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {has("featured") && featured.length > 0 && (
        <section aria-label="Featured products">
          <SectionHeading
            title={meta("featured")?.title ?? "Featured Products"}
            subtitle={meta("featured")?.subtitle ?? undefined}
            action={{ label: "View all", href: "/products?featured=true" }}
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => (
              <ProductCard key={p.id} product={toCard(p)} />
            ))}
          </div>
        </section>
      )}

      {promoBanner && (
        <section aria-label="Special promotion">
          <Link
            href={promoBanner.buttonUrl ?? "/products"}
            className="group relative block overflow-hidden rounded-3xl"
          >
            <div className="relative aspect-[3/1] min-h-[140px] w-full">
              {promoBanner.imageUrl && (
                <Image
                  src={promoBanner.imageUrl}
                  alt={promoBanner.title}
                  fill
                  sizes="1200px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/50 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-center gap-2 p-6 sm:p-10">
                <h3 className="max-w-md text-xl font-extrabold text-white sm:text-2xl lg:text-3xl">
                  {promoBanner.title}
                </h3>
                {promoBanner.subtitle && (
                  <p className="max-w-md text-sm text-slate-200">{promoBanner.subtitle}</p>
                )}
                <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition group-hover:gap-2.5">
                  {promoBanner.buttonLabel ?? "Shop Now"} <ChevronRight className="h-4 w-4" />
                </span>
              </div>
            </div>
          </Link>
        </section>
      )}

      {has("specialOffers") && specialOffers.length > 0 && (
        <section aria-label="Special offers">
          <SectionHeading
            title={meta("specialOffers")?.title ?? "Special Offers"}
            subtitle={meta("specialOffers")?.subtitle ?? undefined}
            action={{ label: "All deals", href: "/products?sort=discount" }}
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {specialOffers.map((p) => (
              <ProductCard key={p.id} product={toCard(p)} />
            ))}
          </div>
        </section>
      )}

      {has("newArrivals") && newArrivals.length > 0 && (
        <section aria-label="New arrivals">
          <SectionHeading
            title={meta("newArrivals")?.title ?? "New Arrivals"}
            subtitle={meta("newArrivals")?.subtitle ?? undefined}
            action={{ label: "View all", href: "/products?sort=newest" }}
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={toCard(p)} />
            ))}
          </div>
        </section>
      )}

      {has("bestSellers") && bestSellers.length > 0 && (
        <section aria-label="Best sellers">
          <SectionHeading
            title={meta("bestSellers")?.title ?? "Best Sellers"}
            subtitle={meta("bestSellers")?.subtitle ?? undefined}
            action={{ label: "View all", href: "/products?sort=best_selling" }}
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {bestSellers.map((p) => (
              <ProductCard key={p.id} product={toCard(p)} />
            ))}
          </div>
        </section>
      )}

      {has("reviews") && topReviews.length > 0 && (
        <section aria-label="Customer reviews">
          <SectionHeading
            title={meta("reviews")?.title ?? "Loved by Customers"}
            subtitle={meta("reviews")?.subtitle ?? undefined}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {topReviews.map((r) => (
              <figure
                key={r.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6"
              >
                <Quote className="h-6 w-6 text-brand-200 dark:text-brand-100" />
                <blockquote className="text-sm leading-relaxed text-muted-foreground">
                  {r.comment.length > 180 ? `${r.comment.slice(0, 180)}…` : r.comment}
                </blockquote>
                <figcaption className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <div>
                    <p className="text-sm font-semibold">{r.authorName}</p>
                    <Link
                      href={`/products/${r.product.slug}`}
                      className="text-xs text-muted-foreground hover:text-brand-600"
                    >
                      on {r.product.name}
                    </Link>
                  </div>
                  <RatingStars rating={r.rating} />
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {has("whyUs") && (
        <section aria-label="Why shop with us">
          <SectionHeading
            title={meta("whyUs")?.title ?? "Why Shop With Us"}
            subtitle={meta("whyUs")?.subtitle ?? undefined}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: BadgeCheck, title: "Curated Quality", text: "Every product is hand-picked and quality-checked before it reaches our catalog." },
              { icon: Truck, title: "Nationwide Delivery", text: "Fast 2–5 day delivery to all 64 districts with real-time order tracking." },
              { icon: CreditCard, title: "Flexible Payment", text: "Pay cash on delivery — bKash and Nagad coming soon for even more convenience." },
              { icon: Headphones, title: "Human Support", text: "Real people, real help. Our support team answers within hours, not days." },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-card">
                <div className="w-fit rounded-2xl bg-brand-50 p-3 text-brand-600 dark:bg-brand-100">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {has("shipping") && (
        <section aria-label="Shipping information" className="overflow-hidden rounded-3xl bg-slate-950">
          <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-2">
            <div>
              <div className="w-fit rounded-2xl bg-slate-900 p-3 text-emerald-400">
                <Truck className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-2xl font-extrabold text-white sm:text-3xl">
                Shipping that keeps up with you
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
                Orders placed before 4 PM ship the same day from our Dhaka warehouse. Track every
                step from packing to your doorstep — no guessing, no calling support.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild className="rounded-full">
                  <Link href="/products">Start Shopping</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full border-slate-700 bg-transparent text-white hover:bg-slate-900 hover:text-white">
                  <Link href="/track-order">Track Order</Link>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Package, value: "2–5 days", label: "Average delivery" },
                { icon: ShieldCheck, value: "৳2,000+", label: "Free shipping over" },
                { icon: Truck, value: "64 districts", label: "Delivery coverage" },
                { icon: BadgeCheck, value: "7 days", label: "Easy returns" },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-slate-900 p-5">
                  <s.icon className="h-5 w-5 text-emerald-400" />
                  <p className="mt-3 text-lg font-bold text-white">{s.value}</p>
                  <p className="text-xs text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
