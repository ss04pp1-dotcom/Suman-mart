import type { MetadataRoute } from "next";
import { apiGet } from "@/lib/backend-proxy";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shopnest.example.com";
  const data = await apiGet<{ products: { slug: string; updatedAt: string }[]; categories: { slug: string }[] }>("/storefront/sitemap");
  const products = data?.products ?? [];
  const categories = data?.categories ?? [];

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/track-order`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/register`, changeFrequency: "yearly", priority: 0.2 },
    ...categories.map((c) => ({
      url: `${base}/products?category=${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: `${base}/products/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
