import type { Metadata } from "next";
import { Suspense } from "react";
import { apiGet } from "@/lib/backend-proxy";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { Header } from "@/components/shop/header";
import { Footer } from "@/components/shop/footer";
import { ConsentBanner } from "@/components/shop/consent-banner";
import { TrackingInit } from "@/components/shop/tracking-init";
import { CartDrawer } from "@/components/shop/cart-drawer";
import { StoreHydration } from "@/components/shop/store-hydration";
import { ShopQueryProvider } from "@/components/shop/query-provider";

export async function generateMetadata(): Promise<Metadata> {
  const layout = await apiGet<{ seo: typeof DEFAULT_SETTINGS.seo }>("/storefront/layout");
  const seo = layout?.seo ?? DEFAULT_SETTINGS.seo;
  return {
    title: { default: seo.defaultTitle, template: "%s | ShopNest" },
    description: seo.defaultDescription,
    keywords: seo.keywords.split(",").map((k) => k.trim()),
  };
}

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const data = await apiGet<{ categories: { name: string; slug: string }[]; general: typeof DEFAULT_SETTINGS.general }>("/storefront/layout");
  const categories = data?.categories ?? [];
  const general = data?.general ?? DEFAULT_SETTINGS.general;

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
