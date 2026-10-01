import type { NextConfig } from "next";

// Security headers other than CSP live here. The Content-Security-Policy is
// set per-response by src/middleware.ts — it is NONCE-BASED (no
// 'unsafe-inline'/'unsafe-eval' for scripts), which cannot be expressed in
// this static headers() form.

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors MUST fail the build — never ship with ignoreBuildErrors.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Canonical React behavior: double-invoked effects catch impure renders.
  // Dev-only double firing of tracking beacons is deduped server-side.
  reactStrictMode: true,
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
