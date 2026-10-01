"use client";

import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { Heart, ShoppingBag, Star, Eye } from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { useWishlist } from "@/lib/stores/wishlist";
import { track } from "@/lib/tracking-client";
import { formatBDT, discountPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  price: number;
  compareAtPrice?: number | null;
  rating?: number;
  reviewCount?: number;
  stock?: number;
  soldCount?: number;
  brand?: string | null;
  imageUrl: string | null;
  category?: { name: string; slug: string } | null;
}

export function RatingStars({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rated ${rating} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(px, i < Math.round(rating) ? "fill-amber-400 text-amber-400" : "fill-muted text-muted")}
        />
      ))}
    </div>
  );
}

export function ProductCard({ product, className }: { product: ProductCardData; className?: string }) {
  const cart = useCart();
  const wishlist = useWishlist();
  const discount = discountPercent(product.price, product.compareAtPrice);
  const inWishlist = wishlist.has(product.id);
  const outOfStock = product.stock === 0;

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (outOfStock) return;
    cart.addItem({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl,
      unitPrice: product.price,
      quantity: 1,
      variantId: null,
      variantLabel: null,
      stock: product.stock ?? 20,
    });
    track("AddToCart", {
      productId: product.id,
      productName: product.name,
      value: product.price,
      quantity: 1,
    });
    toast.success("Added to cart", { description: product.name });
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    const wasAdded = !inWishlist;
    wishlist.toggle({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl,
      price: product.price,
      addedAt: Date.now(),
    });
    if (wasAdded) {
      track("AddToWishlist", { productId: product.id, productName: product.name, value: product.price });
    }
  };

  return (
    <Link
      href={`/products/${product.slug}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover",
        className
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-muted/40">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ShoppingBag className="h-10 w-10" />
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {discount && (
            <Badge className="bg-rose-500 text-white shadow-sm hover:bg-rose-500">-{discount}%</Badge>
          )}
          {outOfStock && (
            <Badge variant="secondary" className="bg-slate-900 text-white hover:bg-slate-900">Out of stock</Badge>
          )}
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 max-sm:opacity-100">
          <button
            onClick={handleWishlist}
            aria-label={inWishlist ? "Remove from wishlist" : "Add to wishlist"}
            className="rounded-full bg-card/95 p-2.5 shadow-sm backdrop-blur transition-colors hover:bg-card"
          >
            <Heart className={cn("h-4 w-4", inWishlist ? "fill-rose-500 text-rose-500" : "text-muted-foreground")} />
          </button>
          <span className="rounded-full bg-card/95 p-2.5 text-muted-foreground shadow-sm backdrop-blur" title="View details">
            <Eye className="h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-600">
          {product.brand ?? product.category?.name}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-600">
          {product.name}
        </h3>
        <div className="flex items-center gap-1.5">
          <RatingStars rating={product.rating ?? 0} />
          <span className="text-xs text-muted-foreground">({product.reviewCount ?? 0})</span>
        </div>
        <div className="mt-auto flex items-end justify-between pt-2">
          <div>
            <p className="text-base font-bold">{formatBDT(product.price)}</p>
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <p className="text-xs text-muted-foreground line-through">{formatBDT(product.compareAtPrice)}</p>
            )}
          </div>
          <Button
            size="icon"
            onClick={handleAdd}
            disabled={outOfStock}
            aria-label={`Add ${product.name} to cart`}
            className="h-9 w-9 rounded-full"
          >
            <ShoppingBag className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Link>
  );
}
