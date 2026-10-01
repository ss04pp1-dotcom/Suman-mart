"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Heart, Minus, Plus, ShoppingBag, Zap, Truck, RotateCcw, ShieldCheck } from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { useWishlist } from "@/lib/stores/wishlist";
import { track } from "@/lib/tracking-client";
import { formatBDT, discountPercent } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { RatingStars } from "./product-card";

export interface VariantGroup {
  name: string;
  options: { id: string; label: string; stock: number; price?: number | null }[];
}

export interface PurchasePanelProps {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    compareAtPrice: number | null;
    stock: number;
    rating: number;
    reviewCount: number;
    shortDescription: string | null;
    images: { url: string; alt: string | null }[];
    brand: string | null;
  };
  variantGroups: VariantGroup[];
  shipping: { flatRate: number; freeShippingThreshold: number; estimatedDaysMin: number; estimatedDaysMax: number };
}

export function ProductGallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [active, setActive] = useState(0);
  const current = images[active];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-border bg-muted/40">
        {current && (
          <Image
            src={current.url}
            alt={current.alt ?? name}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
          {images.map((img, i) => (
            <button
              key={img.url + i}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              className={cn(
                "relative aspect-square h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition-all",
                i === active ? "border-brand-600" : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <Image src={img.url} alt={img.alt ?? name} fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PurchasePanel({ product, variantGroups, shipping }: PurchasePanelProps) {
  const cart = useCart();
  const wishlist = useWishlist();
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      variantGroups.map((g) => [g.name, ""])
    )
  );

  const chosenOptions = useMemo(
    () => variantGroups.map((g) => ({ group: g, option: g.options.find((o) => o.label === selected[g.name]) })),
    [variantGroups, selected]
  );

  const allSelected = chosenOptions.every((c) => c.option);
  const selectedStock = allSelected
    ? Math.min(...chosenOptions.map((c) => c.option!.stock))
    : product.stock;
  const selectedPrice = allSelected
    ? chosenOptions.reduce((p, c) => p ?? c.option!.price ?? null, null as number | null) ?? product.price
    : product.price;

  const discount = discountPercent(selectedPrice, product.compareAtPrice);
  const outOfStock = selectedStock === 0;
  const inWishlist = wishlist.has(product.id);

  const buildItem = () => ({
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imageUrl: product.images[0]?.url ?? null,
    unitPrice: selectedPrice,
    quantity,
    variantId: allSelected ? chosenOptions[0]?.option?.id ?? null : null,
    variantLabel: allSelected
      ? chosenOptions.map((c) => `${c.group.name}: ${c.option!.label}`).join(" · ") || null
      : null,
    stock: selectedStock,
  });

  const handleAdd = () => {
    if (outOfStock) return;
    if (variantGroups.length > 0 && !allSelected) {
      toast.error("Please select the required options first");
      return;
    }
    cart.addItem(buildItem());
    track("AddToCart", {
      productId: product.id,
      productName: product.name,
      value: selectedPrice * quantity,
      quantity,
    });
    toast.success("Added to cart", { description: product.name });
  };

  const handleBuyNow = () => {
    if (outOfStock) return;
    if (variantGroups.length > 0 && !allSelected) {
      toast.error("Please select the required options first");
      return;
    }
    cart.addItem(buildItem());
    track("AddToCart", {
      productId: product.id,
      productName: product.name,
      value: selectedPrice * quantity,
      quantity,
    });
    window.location.href = "/checkout";
  };

  const toggleWishlist = () => {
    const wasAdded = !inWishlist;
    wishlist.toggle({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.images[0]?.url ?? null,
      price: selectedPrice,
      addedAt: Date.now(),
    });
    if (wasAdded) track("AddToWishlist", { productId: product.id, productName: product.name, value: selectedPrice });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        {product.brand && (
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-600">
            {product.brand}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
          {product.name}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <RatingStars rating={product.rating} size="md" />
          <span className="text-sm font-medium">{product.rating.toFixed(1)}</span>
          <a href="#reviews" className="text-sm text-muted-foreground hover:text-brand-600">
            {product.reviewCount} review{product.reviewCount !== 1 ? "s" : ""}
          </a>
        </div>
      </div>

      <div className="flex items-end gap-3">
        <p className="text-3xl font-extrabold">{formatBDT(selectedPrice)}</p>
        {discount && (
          <>
            <p className="pb-1 text-lg text-muted-foreground line-through">
              {formatBDT(product.compareAtPrice!)}
            </p>
            <Badge className="mb-1.5 bg-rose-500 text-white hover:bg-rose-500">Save {discount}%</Badge>
          </>
        )}
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{product.shortDescription}</p>

      <div className="flex items-center gap-2 text-sm">
        {outOfStock ? (
          <Badge variant="secondary" className="bg-slate-900 text-white hover:bg-slate-900">Out of stock</Badge>
        ) : selectedStock <= 5 ? (
          <Badge className="bg-amber-500 text-white hover:bg-amber-500">
            Only {selectedStock} left — order soon
          </Badge>
        ) : (
          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">In stock</Badge>
        )}
      </div>

      {/* Variant groups */}
      {variantGroups.map((group) => (
        <div key={group.name}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">
              {group.name}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {selected[group.name] ? selected[group.name] : "Select"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {group.options.map((opt) => {
              const isSelected = selected[group.name] === opt.label;
              const disabled = opt.stock === 0;
              return (
                <button
                  key={opt.id}
                  disabled={disabled}
                  onClick={() => setSelected((s) => ({ ...s, [group.name]: opt.label }))}
                  className={cn(
                    "rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                    isSelected
                      ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-600"
                      : "border-border hover:border-brand-300",
                    disabled && "cursor-not-allowed opacity-40 line-through"
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Quantity + actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-12 w-fit items-center rounded-xl border border-border">
          <button
            className="h-full px-4 text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-10 text-center font-semibold">{quantity}</span>
          <button
            className="h-full px-4 text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => setQuantity((q) => Math.min(selectedStock || 20, q + 1))}
            disabled={quantity >= selectedStock}
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <Button
          size="lg"
          variant="outline"
          className="h-12 flex-1 rounded-xl"
          onClick={handleAdd}
          disabled={outOfStock}
        >
          <ShoppingBag className="mr-2 h-5 w-5" /> Add to Cart
        </Button>
        <Button size="lg" className="h-12 flex-1 rounded-xl" onClick={handleBuyNow} disabled={outOfStock}>
          <Zap className="mr-2 h-5 w-5" /> Buy Now
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-12 w-12 shrink-0 rounded-xl p-0"
          onClick={toggleWishlist}
          aria-label={inWishlist ? "Remove from wishlist" : "Add to wishlist"}
        >
          <Heart className={cn("h-5 w-5", inWishlist && "fill-rose-500 text-rose-500")} />
        </Button>
      </div>

      <Separator />

      {/* Delivery info */}
      <div className="grid gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm sm:grid-cols-3">
        <div className="flex items-start gap-2.5">
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div>
            <p className="font-medium">Fast delivery</p>
            <p className="text-xs text-muted-foreground">
              {shipping.estimatedDaysMin}–{shipping.estimatedDaysMax} days nationwide
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div>
            <p className="font-medium">Cash on delivery</p>
            <p className="text-xs text-muted-foreground">
              {shipping.freeShippingThreshold > 0
                ? `Free shipping over ${formatBDT(shipping.freeShippingThreshold)}`
                : `Shipping ${formatBDT(shipping.flatRate)}`}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div>
            <p className="font-medium">7-day returns</p>
            <p className="text-xs text-muted-foreground">Hassle-free return policy</p>
          </div>
        </div>
      </div>
    </div>
  );
}
