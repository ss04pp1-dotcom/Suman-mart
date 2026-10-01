"use client";

import Link from "next/link";
import Image from "next/image";
import { Heart, ShoppingBag, Trash2 } from "lucide-react";
import { useWishlist } from "@/lib/stores/wishlist";
import { useCart } from "@/lib/stores/cart";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";

export default function WishlistPage() {
  const wishlist = useWishlist();
  const cart = useCart();

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

  if (wishlist.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
        <div className="rounded-full bg-muted p-6">
          <Heart className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-extrabold">Your wishlist is empty</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Tap the heart on any product to save it here for later.
        </p>
        <Button asChild size="lg" className="mt-2 rounded-full">
          <Link href="/products">Discover Products</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          My Wishlist <span className="text-base font-medium text-muted-foreground">({wishlist.items.length})</span>
        </h1>
        <Button variant="ghost" onClick={() => wishlist.clear()} className="text-rose-600 hover:text-rose-600">
          <Trash2 className="mr-2 h-4 w-4" /> Clear all
        </Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {wishlist.items.map((entry) => (
          <div key={entry.productId} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-card-hover">
            <Link href={`/products/${entry.slug}`} className="relative aspect-square overflow-hidden bg-muted/40">
              {entry.imageUrl && (
                <Image src={entry.imageUrl} alt={entry.name} fill sizes="300px" className="object-cover transition-transform duration-500 group-hover:scale-105" />
              )}
            </Link>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <Link href={`/products/${entry.slug}`} className="line-clamp-2 text-sm font-semibold hover:text-brand-600">
                {entry.name}
              </Link>
              <p className="text-base font-bold">{formatBDT(entry.price)}</p>
              <div className="mt-auto flex gap-2 pt-2">
                <Button size="sm" className="flex-1 rounded-lg" onClick={() => moveToCart(entry)}>
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
    </div>
  );
}
