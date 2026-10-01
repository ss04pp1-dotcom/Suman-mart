"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Minus, Plus, ShoppingBag, Tag, Trash2, TicketPercent, X, Loader2, Lock } from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface ValidatedLine {
  productId: string;
  variantId: string | null;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  total: number;
  options: Record<string, string> | null;
  stock: number;
}

interface CartValidation {
  lines: ValidatedLine[];
  errors: string[];
  coupon: { ok: boolean; reason: string | null; code: string | null; discount: number; freeShipping: boolean; type: string | null } | null;
  totals: { subtotal: number; discount: number; shippingTotal: number; total: number; freeShipping: boolean };
}

export default function CartPage() {
  const cart = useCart();
  const router = useRouter();
  const [validation, setValidation] = useState<CartValidation | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const validate = useCallback(
    async (couponCode?: string | null) => {
      if (cart.items.length === 0) {
        setValidation(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/cart/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
            couponCode: couponCode ?? appliedCoupon,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setValidation(data.data);
          if (data.data.errors.length > 0) {
            data.data.errors.forEach((e: string) => toast.warning(e));
          }
        }
      } catch {
        toast.error("Could not refresh the cart. Please reload.");
      } finally {
        setLoading(false);
      }
    },
    [cart.items, appliedCoupon]
  );

  useEffect(() => {
    const t = setTimeout(() => validate(), 350);
    return () => clearTimeout(t);
  }, [cart.items, validate]);

  useEffect(() => {
    if (cart.items.length > 0) {
      track("ViewCart", {
        value: cart.subtotal(),
        quantity: cart.count(),
      });
    }
     
  }, []);

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCheckingCoupon(true);
    try {
      const res = await fetch("/api/cart/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
          couponCode: couponInput.trim().toUpperCase(),
        }),
      });
      const data = await res.json();
      if (data.success && data.data.coupon) {
        if (data.data.coupon.ok) {
          setAppliedCoupon(data.data.coupon.code);
          setValidation(data.data);
          toast.success(`Coupon ${data.data.coupon.code} applied!`, {
            description: data.data.coupon.freeShipping ? "Free shipping unlocked" : `You saved ${formatBDT(data.data.coupon.discount)}`,
          });
        } else {
          toast.error(data.data.coupon.reason ?? "Invalid coupon");
        }
      }
    } catch {
      toast.error("Could not validate the coupon");
    } finally {
      setCheckingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput("");
    validate(null);
  };

  const goCheckout = () => {
    if (validation && validation.errors.length > 0) {
      toast.error("Please resolve the cart issues before checkout");
      return;
    }
    track("InitiateCheckout", {
      value: validation?.totals.total ?? cart.subtotal(),
      quantity: cart.count(),
    });
    const couponParam = appliedCoupon ? `?coupon=${encodeURIComponent(appliedCoupon)}` : "";
    router.push(`/checkout${couponParam}`);
  };

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-24 text-center">
        <div className="rounded-full bg-muted p-6">
          <ShoppingBag className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-extrabold">Your cart is empty</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Looks like you have not added anything yet. Explore our collections to find something you love.
        </p>
        <Button asChild size="lg" className="mt-2 rounded-full">
          <Link href="/products">Start Shopping <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>
    );
  }

  const totals = validation?.totals;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight sm:text-3xl">
        Shopping Cart <span className="text-base font-medium text-muted-foreground">({cart.count()} items)</span>
      </h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        {/* Lines */}
        <div className="space-y-4">
          {cart.items.map((item) => {
            const line = validation?.lines.find((l) => l.productId === item.productId && l.variantId === item.variantId);
            const priceChanged = line && line.unitPrice !== item.unitPrice;
            return (
              <div key={`${item.productId}-${item.variantId ?? "base"}`} className="flex gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
                <Link href={`/products/${item.slug}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted/40 sm:h-28 sm:w-28">
                  {item.imageUrl && <Image src={item.imageUrl} alt={item.name} fill sizes="112px" className="object-cover" />}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/products/${item.slug}`} className="line-clamp-2 font-semibold hover:text-brand-600">
                        {item.name}
                      </Link>
                      {item.variantLabel && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.variantLabel}</p>
                      )}
                      {priceChanged && (
                        <p className="mt-1 text-xs font-medium text-amber-600">
                          Price updated to {formatBDT(line.unitPrice)}
                        </p>
                      )}
                    </div>
                    <button
                      className="shrink-0 text-muted-foreground transition-colors hover:text-rose-500"
                      onClick={() => {
                        cart.removeItem(item.productId, item.variantId);
                        toast.success("Removed from cart");
                      }}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="h-4.5 w-4.5" />
                    </button>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="flex items-center rounded-xl border border-border">
                      <button
                        className="px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
                        onClick={() => cart.updateQuantity(item.productId, item.variantId, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-9 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        className="px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
                        onClick={() => cart.updateQuantity(item.productId, item.variantId, item.quantity + 1)}
                        disabled={item.quantity >= (line?.stock ?? item.stock)}
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatBDT((line?.unitPrice ?? item.unitPrice) * item.quantity)}</p>
                      <p className="text-xs text-muted-foreground">{formatBDT(line?.unitPrice ?? item.unitPrice)} each</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <Button variant="ghost" asChild className="text-brand-700 dark:text-brand-600">
            <Link href="/products">
              <ArrowRight className="mr-2 h-4 w-4 rotate-180" /> Continue shopping
            </Link>
          </Button>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-36 lg:h-fit" aria-label="Order summary">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold">Order Summary</h2>

            {/* Coupon */}
            <div className="mt-5">
              {appliedCoupon ? (
                <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 dark:bg-brand-100">
                  <div className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-600">
                    <TicketPercent className="h-4 w-4" />
                    {appliedCoupon} applied
                  </div>
                  <button onClick={removeCoupon} className="text-brand-700 hover:text-rose-500 dark:text-brand-600" aria-label="Remove coupon">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="Coupon code"
                      className="pl-9 uppercase"
                      aria-label="Coupon code"
                    />
                  </div>
                  <Button variant="outline" onClick={applyCoupon} disabled={checkingCoupon || !couponInput.trim()}>
                    {checkingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </Button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Try WELCOME10 or FREESHIP</p>
            </div>

            <Separator className="my-5" />

            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{loading ? "…" : formatBDT(totals?.subtotal ?? cart.subtotal())}</span>
              </div>
              {totals && totals.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount</span>
                  <span className="font-medium">−{formatBDT(totals.discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                {loading ? (
                  <span>…</span>
                ) : totals && totals.freeShipping ? (
                  <span className="font-medium text-emerald-600">FREE</span>
                ) : (
                  <span className="font-medium">{formatBDT(totals?.shippingTotal ?? 60)}</span>
                )}
              </div>
              <Separator />
              <div className="flex justify-between text-base font-extrabold">
                <span>Total</span>
                <span>{loading ? "…" : formatBDT(totals?.total ?? cart.subtotal() + 60)}</span>
              </div>
            </div>

            <Button size="lg" className="mt-6 w-full rounded-xl" onClick={goCheckout} disabled={loading}>
              <Lock className="mr-2 h-4 w-4" /> Proceed to Checkout
            </Button>

            {validation && validation.errors.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                {validation.errors.map((e, i) => (
                  <p key={i}>• {e}</p>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
