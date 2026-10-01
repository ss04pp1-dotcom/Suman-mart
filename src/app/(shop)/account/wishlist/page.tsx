import { getCurrentCustomer } from "@/lib/auth";
import { db } from "@/lib/db";
import { WishlistGrid } from "@/components/shop/wishlist-grid";

export default async function AccountWishlistPage() {
  const customer = await getCurrentCustomer();
  if (!customer) return null;
  // Count of past orders referenced for the "reorder" hint
  const orderCount = await db.order.count({ where: { customerId: customer.id } });
  void orderCount;

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
