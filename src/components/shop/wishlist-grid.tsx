"use client";

import Link from "next/link";
import Image from "next/image";
import { Heart, ShoppingBag, Trash2 } from "lucide-react";
import { useWishlist } from "@/lib/stores/wishlist";
import { useCart } from "@/lib/stores/cart";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function WishlistGrid() {
  const wishlist = useWishlist();
  const cart = useCart();

  if (wishlist.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-14 text-center">
        <Heart className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <p className="text-lg font-bold">Nothing saved yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Tap the heart on any product to save it.</p>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/products">Browse Products</Link>
        </Button>
      </div>
    );
  }

  const moveToCart = (entry: (typeof wishlist.items)[number]) => {
    cart.addItem({
      productId: entry.productId,
      slug: entry.slug,
      name: entry.name,
      imageUrl: entry.imageUrl,
      unitPrice: entry.price,
      quantity: 1,
      variantId: null,
      variantLabel: null,
      stock: 20,
    });
    track("AddToCart", { productId: entry.productId, productName: entry.name, value: entry.price, quantity: 1 });
    wishlist.remove(entry.productId);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {wishlist.items.map((entry) => (
        <div key={entry.productId} className="group flex gap-4 rounded-2xl border border-border bg-card p-4">
          <Link href={`/products/${entry.slug}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted/40">
            {entry.imageUrl && <Image src={entry.imageUrl} alt={entry.name} fill sizes="96px" className="object-cover" />}
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <Link href={`/products/${entry.slug}`} className="line-clamp-2 text-sm font-semibold hover:text-brand-600">
              {entry.name}
            </Link>
            <p className="mt-1 text-sm font-bold">{formatBDT(entry.price)}</p>
            <div className="mt-auto flex gap-2 pt-2">
              <Button size="sm" className="rounded-lg" onClick={() => moveToCart(entry)}>
                <ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Add to Cart
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={() => wishlist.remove(entry.productId)} aria-label="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
