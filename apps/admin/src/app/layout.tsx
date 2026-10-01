import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Admin console root layout. All pages render per-request: the
// Content-Security-Policy is NONCE-BASED (src/middleware.ts), and a
// prerendered page would carry a stale nonce whose scripts the browser
// then blocks.
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
    default: "Admin Console",
    template: "%s | ShopNest Console",
  },
  description: "ShopNest administration console.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
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
        {/* bottom-left keeps toasts clear of admin page action buttons */}
        <Toaster richColors position="bottom-left" />
      </body>
    </html>
  );
}
