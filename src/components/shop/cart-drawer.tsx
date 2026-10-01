"use client";

import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CartDrawer() {
  const cart = useCart();

  const subtotal = cart.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  // ViewCart is tracked once per drawer open
  const onView = (open: boolean) => {
    cart.setOpen(open);
    if (open && cart.items.length > 0) {
      track("ViewCart", {
        value: subtotal,
        quantity: cart.items.reduce((q, i) => q + i.quantity, 0),
      });
    }
  };

  return (
    <Sheet open={cart.isOpen} onOpenChange={onView}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-brand-600" />
            Your Cart
            <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-100 dark:text-brand-600">
              {cart.count()}
            </span>
          </SheetTitle>
        </SheetHeader>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="rounded-full bg-muted p-4">
              <ShoppingBag className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-semibold">Your cart is empty</p>
            <p className="text-sm text-muted-foreground">Browse our collections and find something you love.</p>
            <Button onClick={() => onView(false)} asChild className="mt-2">
              <Link href="/products">Continue Shopping</Link>
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {cart.items.map((item) => (
                  <div
                    key={`${item.productId}-${item.variantId ?? "base"}`}
                    className="flex gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                      {item.imageUrl && (
                        <Image src={item.imageUrl} alt={item.name} fill sizes="80px" className="object-cover" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/products/${item.slug}`}
                        onClick={() => onView(false)}
                        className="line-clamp-2 text-sm font-medium hover:text-brand-600"
                      >
                        {item.name}
                      </Link>
                      {item.variantLabel && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.variantLabel}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex items-center rounded-lg border border-border">
                          <button
                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                            disabled={item.quantity <= 1}
                            onClick={() => cart.updateQuantity(item.productId, item.variantId, item.quantity - 1)}
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                            disabled={item.quantity >= item.stock}
                            onClick={() => cart.updateQuantity(item.productId, item.variantId, item.quantity + 1)}
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{formatBDT(item.unitPrice * item.quantity)}</span>
                          <button
                            className="text-muted-foreground hover:text-rose-500"
                            onClick={() => {
                              cart.removeItem(item.productId, item.variantId);
                              toast.success("Removed from cart", { description: item.name });
                            }}
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <SheetFooter className="border-t border-border">
              <div className="w-full space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-base font-bold">{formatBDT(subtotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Shipping and coupons are applied at checkout.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => onView(false)} asChild>
                    <Link href="/cart">View Cart</Link>
                  </Button>
                  <Button onClick={() => onView(false)} asChild>
                    <Link href="/checkout">
                      Checkout <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
