import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { parseJSON, safeJsonLd } from "@/lib/json";
import { formatBDT } from "@/lib/format";
import { ProductGallery, PurchasePanel, type VariantGroup } from "@/components/shop/purchase-panel";
import { ProductReviews } from "@/components/shop/product-reviews";
import { ProductCard } from "@/components/shop/product-card";
import { SectionHeading } from "@/components/shop/section-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Plus, CheckCircle2 } from "lucide-react";
import { ProductDetailTracker } from "@/components/shop/detail-tracker";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // isActive filter — unpublished product data must never leak into metadata
  const product = await db.product.findFirst({
    where: { slug, isActive: true },
    select: { name: true, seoTitle: true, seoDescription: true, shortDescription: true, images: { take: 1 } },
  });
  if (!product) return { title: "Product Not Found" };
  const title = product.seoTitle ?? `${product.name} — Buy Online`;
  const description = product.seoDescription ?? product.shortDescription ?? undefined;
  return {
    title,
    description,
    alternates: { canonical: `/products/${slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      images: product.images[0]?.url ? [product.images[0].url] : undefined,
    },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, shipping] = await Promise.all([
    db.product.findFirst({
      where: { slug, isActive: true },
      include: {
        category: { select: { name: true, slug: true } },
        images: { orderBy: { sortOrder: "asc" } },
        variants: { orderBy: { sortOrder: "asc" } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
        reviews: { where: { status: "APPROVED" }, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }], take: 10 },
      },
    }),
    getSetting("shipping"),
  ]);

  if (!product) notFound();

  const specifications = parseJSON<{ group: string; key: string; value: string }[]>(product.specifications, []);

  // Group variants by name (e.g. "Color", "Size")
  const variantMap = new Map<string, VariantGroup>();
  for (const v of product.variants) {
    const opts = parseJSON<Record<string, string>>(v.options, {});
    const label = Object.values(opts)[0] ?? v.name;
    const group = variantMap.get(v.name) ?? { name: v.name, options: [] };
    group.options.push({ id: v.id, label, stock: v.stock, price: v.price });
    variantMap.set(v.name, group);
  }
  const variantGroups = [...variantMap.values()];

  // Related & FBT
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

  const toCard = (p: { id: string; name: string; slug: string; price: number; compareAtPrice: number | null; rating: number; reviewCount: number; stock: number; soldCount: number; brand: string | null; images: { url: string }[]; category: { name: string; slug: string } | null }) => ({
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

  const relatedProducts = [
    ...relations.map((r) => toCard(r.relatedProduct)),
    ...autoRelated.map((p) => toCard(p)).filter((p) => !relations.some((r) => r.relatedProduct.id === p.id)),
  ].slice(0, 4);

  const fbtProducts = fbt.map((r) => toCard(r.relatedProduct));
  const fbtTotal = fbtProducts.reduce((s, p) => s + p.price, 0) + product.price;

  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription ?? undefined,
    image: product.images.map((i) => i.url),
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    aggregateRating:
      product.reviewCount > 0
        ? { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviewCount }
        : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: product.price,
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <ProductDetailTracker productId={product.id} productName={product.name} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-brand-600">Home</Link>
        <span>/</span>
        <Link href="/products" className="hover:text-brand-600">Products</Link>
        <span>/</span>
        <Link href={`/products?category=${product.category.slug}`} className="hover:text-brand-600">
          {product.category.name}
        </Link>
        <span>/</span>
        <span className="line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery images={product.images.map((i) => ({ url: i.url, alt: i.alt }))} name={product.name} />
        <PurchasePanel
          product={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            compareAtPrice: product.compareAtPrice,
            stock: product.stock,
            rating: product.rating,
            reviewCount: product.reviewCount,
            shortDescription: product.shortDescription,
            images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
            brand: product.brand,
          }}
          variantGroups={variantGroups}
          shipping={shipping}
        />
      </div>

      {/* Frequently bought together */}
      {fbtProducts.length > 0 && (
        <section aria-label="Frequently bought together" className="mt-12">
          <SectionHeading title="Frequently Bought Together" subtitle="Customers often buy these together" />
          <div className="rounded-3xl border border-border bg-card p-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
              {/* Horizontal-scroll on mobile — 4+ bundled thumbnails (80px each
                  + separators) exceed a 390px viewport and previously caused
                  horizontal page overflow. */}
              <div className="flex max-w-full items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
                {[toCard({ ...product, images: product.images, brand: product.brand, category: product.category, compareAtPrice: product.compareAtPrice }), ...fbtProducts].map((p, i) => (
                  <div key={p.id} className="flex shrink-0 items-center gap-3">
                    {i > 0 && <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <Link
                      href={`/products/${p.slug}`}
                      className="group relative block h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border sm:h-24 sm:w-24"
                    >
                      {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
                    </Link>
                  </div>
                ))}
              </div>
              <div className="sm:ml-auto sm:text-right">
                <p className="text-sm text-muted-foreground">Bundle price</p>
                <p className="text-2xl font-extrabold">{formatBDT(fbtTotal)}</p>
                <p className="text-xs text-emerald-600">Save on this popular combination</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tabs: description / specs / reviews */}
      <section className="mt-12" id="reviews">
        <Tabs defaultValue="description">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 no-scrollbar sm:w-fit">
            <TabsTrigger value="description" className="rounded-xl px-5 py-2.5">Description</TabsTrigger>
            <TabsTrigger value="specifications" className="rounded-xl px-5 py-2.5">Specifications</TabsTrigger>
            <TabsTrigger value="reviews" className="rounded-xl px-5 py-2.5">
              Reviews ({product.reviewCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="description" className="mt-6">
            <div className="max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
              {product.description ?? product.shortDescription}
            </div>
            {product.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {product.tags.map((t) => (
                  <Link
                    key={t.tag.slug}
                    href={`/products?tag=${t.tag.slug}`}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-300 hover:text-brand-600"
                  >
                    #{t.tag.name}
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="specifications" className="mt-6">
            {specifications.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No specifications listed for this product.
              </p>
            ) : (
              <div className="max-w-3xl overflow-hidden rounded-2xl border border-border">
                {specifications.map((spec, i) => (
                  <div
                    key={`${spec.group}-${spec.key}-${i}`}
                    className="grid grid-cols-3 gap-4 border-b border-border/60 p-4 text-sm last:border-0 odd:bg-muted/30"
                  >
                    <span className="col-span-1 font-medium text-muted-foreground">
                      {spec.group} · {spec.key}
                    </span>
                    <span className="col-span-2 flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" /> {spec.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="mt-6">
            <ProductReviews
              productId={product.id}
              productName={product.name}
              rating={product.rating}
              reviewCount={product.reviewCount}
              reviews={product.reviews.map((r) => ({
                id: r.id,
                authorName: r.authorName,
                rating: r.rating,
                title: r.title,
                comment: r.comment,
                isFeatured: r.isFeatured,
                verifiedPurchase: r.verifiedPurchase,
                createdAt: r.createdAt.toISOString(),
                adminReply: r.adminReply,
              }))}
            />
          </TabsContent>
        </Tabs>
      </section>

      {/* Related products */}
      {relatedProducts.length > 0 && (
        <section className="mt-14">
          <SectionHeading title="You May Also Like" subtitle="Recommended based on this product" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {relatedProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
        <Package className="h-4 w-4" />
        Questions about this product? Reach us on {shipping.flatRate >= 0 ? "support@shopnest.com.bd" : ""}
      </div>
    </div>
  );
}
