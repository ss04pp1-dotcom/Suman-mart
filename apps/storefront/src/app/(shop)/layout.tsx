import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { Header } from "@/components/shop/header";
import { Footer } from "@/components/shop/footer";
import { ConsentBanner } from "@/components/shop/consent-banner";
import { TrackingInit } from "@/components/shop/tracking-init";
import { CartDrawer } from "@/components/shop/cart-drawer";
import { StoreHydration } from "@/components/shop/store-hydration";
import { ShopQueryProvider } from "@/components/shop/query-provider";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSetting("seo");
  return {
    title: { default: seo.defaultTitle, template: "%s | ShopNest" },
    description: seo.defaultDescription,
    keywords: seo.keywords.split(",").map((k) => k.trim()),
  };
}

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [categories, general] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, slug: true },
    }),
    getSetting("general"),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header categories={categories} storeName={general.storeName} />
      <main className="flex-1">
        <ShopQueryProvider>{children}</ShopQueryProvider>
      </main>
      <Footer
        storeName={general.storeName}
        supportPhone={general.supportPhone}
        supportEmail={general.supportEmail}
        address={general.address}
      />
      <CartDrawer />
      <ConsentBanner />
      <StoreHydration />
      <Suspense fallback={null}>
        <TrackingInit />
      </Suspense>
    </div>
  );
}
