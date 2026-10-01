import type { Metadata } from "next";

// Admin console metadata — keeps the storefront title/description out of admin
// pages (they previously inherited "Online Shopping in Bangladesh") and ensures
// the console is never indexed by search engines. Per-page titles are set on
// the client by AdminShell (titleForPath) since the shell is a client component.
export const metadata: Metadata = {
  title: {
    default: "Admin Console",
    template: "%s | ShopNest Console",
  },
  description: "ShopNest administration console.",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
