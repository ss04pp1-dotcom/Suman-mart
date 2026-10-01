import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────
// Admin application — standalone Next.js deployment (admin.example.com).
//
// This app is the admin UI ONLY: every /api/admin/* request is proxied to the
// shared backend origin (BACKEND_ORIGIN). Today that is the storefront
// service's Node API; once the admin write-paths finish porting to the
// Cloudflare Workers API (apps/api), BACKEND_ORIGIN flips to
// https://api.example.com and this app's code does not change at all.
//
// Media (product/banner/category/upload images) is served from the backend
// origin too — image optimization is disabled because the optimizer would
// otherwise need direct access to the media store.
// ─────────────────────────────────────────────────────────────────────────

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  images: {
    // Media is proxied from the backend origin; optimization happens there.
    unoptimized: true,
  },
  // NOTE: /api/admin/* and media paths are proxied at RUNTIME by
  // src/app/api/admin/[...path]/route.ts + src/app/{products,banners,
  // categories,uploads}/[...path]/route.ts (src/lib/backend-proxy.ts), NOT by
  // rewrites() — rewrites are evaluated at build time and would bake the
  // BACKEND_ORIGIN into the build output.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
