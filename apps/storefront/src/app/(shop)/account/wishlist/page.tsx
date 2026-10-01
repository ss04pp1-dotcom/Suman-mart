import { apiGet, type AccountOverview } from "@/lib/backend-proxy";

import { WishlistGrid } from "@/components/shop/wishlist-grid";

export default async function AccountWishlistPage() {
  const data = await apiGet<AccountOverview>("/storefront/account/overview");
  if (!data) return null; // sign-in required (client components handle the rest)
  const customer = data.customer;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">My Wishlist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {customer.name.split(" ")[0]}, your saved products live here across all your devices on this browser.
        </p>
      </div>
      <WishlistGrid />
    </div>
  );
}
