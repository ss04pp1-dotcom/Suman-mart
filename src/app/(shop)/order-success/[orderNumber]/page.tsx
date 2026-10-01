import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseJSON } from "@/lib/json";
import { formatBDT, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Package, Truck, MapPin, Banknote } from "lucide-react";
import { PurchaseTracker } from "@/components/shop/purchase-tracker";

export const metadata: Metadata = {
  title: "Order Confirmed",
  robots: { index: false },
};

export default async function OrderSuccessPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;

  const order = await db.order.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
    include: { items: true },
  });
  if (!order) notFound();

  const address = parseJSON<{ fullName: string; phone: string; line1: string; city: string; area?: string | null }>(
    order.shippingAddress,
    { fullName: order.customerName, phone: order.customerPhone, line1: "", city: "" }
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {/* Browser Purchase event — shares the eventId with the server copy for dedup */}
      <PurchaseTracker
        eventId={order.purchaseEventId ?? `purchase_${order.orderNumber}`}
        value={order.total}
        orderNumber={order.orderNumber}
      />

      <div className="flex flex-col items-center text-center">
        <div className="rounded-full bg-emerald-50 p-4 dark:bg-emerald-950/50">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">Thank you for your order!</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Your order has been placed successfully. We will call you shortly to confirm delivery details.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-muted px-5 py-2.5 font-mono text-lg font-bold tracking-wide">
          {order.orderNumber}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Package, label: "Order status", value: "Pending confirmation" },
            { icon: Truck, label: "Estimated delivery", value: order.estimatedDelivery ? `${order.estimatedDelivery.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "2–5 days" },
            { icon: Banknote, label: "Payment", value: order.paymentMethod === "COD" ? "Cash on Delivery" : order.paymentMethod },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4">
              <s.icon className="h-5 w-5 text-brand-600" />
              <p className="mt-2 text-xs text-muted-foreground">{s.label}</p>
              <p className="text-sm font-semibold">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="font-bold">Order details</p>
          <div className="mt-4 space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Qty {item.quantity}
                    {item.options ? ` · ${Object.values(parseJSON<Record<string, string>>(item.options, {})).join(", ")}` : ""}
                  </p>
                </div>
                <p className="font-semibold">{formatBDT(item.total)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span><span>{formatBDT(order.subtotal)}</span>
            </div>
            {order.discountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount {order.couponCode ? `(${order.couponCode})` : ""}</span>
                <span>−{formatBDT(order.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>{order.shippingTotal === 0 ? "FREE" : formatBDT(order.shippingTotal)}</span>
            </div>
            <div className="flex justify-between text-base font-extrabold">
              <span>Total</span><span>{formatBDT(order.total)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-5 text-sm">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="font-semibold">Delivery address</p>
            <p className="mt-1 text-muted-foreground">
              {address.fullName} · {address.phone}
            </p>
            <p className="text-muted-foreground">
              {address.line1}{address.area ? `, ${address.area}` : ""}, {address.city}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Placed {formatDateTime(order.createdAt)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="flex-1 rounded-xl">
            <Link href="/track-order">Track This Order</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="flex-1 rounded-xl">
            <Link href="/products">Continue Shopping</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
