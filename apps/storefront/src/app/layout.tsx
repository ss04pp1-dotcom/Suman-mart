import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// All HTML pages render per-request: the Content-Security-Policy is
// NONCE-BASED (src/middleware.ts), and a prerendered page would carry a
// stale nonce whose scripts the browser then blocks. For a storefront with
// live stock/prices this is the correct rendering mode anyway; static
// assets (JS/CSS/images) are still served from cache.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    // Brand-free default — the template appends "| ShopNest" exactly once.
    default: "Online Shopping in Bangladesh",
    template: "%s | ShopNest",
  },
  description:
    "Shop electronics, fashion, home essentials and more with fast delivery across Bangladesh. Cash on delivery available.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "ShopNest — Online Shopping in Bangladesh",
    description: "Everything you love, delivered to your nest.",
    siteName: "ShopNest",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        {/* bottom-left keeps toasts clear of the sticky order-summary CTAs (right column)
            on the storefront and of admin page action buttons */}
        <Toaster richColors position="bottom-left" />
      </body>
    </html>
  );
}
