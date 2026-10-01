"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { PackageSearch, Loader2, Truck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderTimeline, OrderStatusBadge } from "@/components/shop/order-timeline";
import { formatBDT, formatDateTime, PAYMENT_METHOD_LABELS } from "@/lib/format";

interface TrackedOrder {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  courier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  createdAt: string;
  items: { name: string; imageUrl: string | null; quantity: number; total: number; options: Record<string, string> | null }[];
  statusHistory: { status: string; note: string | null; createdAt: string }[];
}

export default function TrackOrderPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [supportPhone, setSupportPhone] = useState<string | null>(null);

  // Real support line from store settings (no hardcoded placeholder numbers)
  useEffect(() => {
    fetch("/api/settings/public")
      .then((r) => r.json())
      .then((d) => setSupportPhone(d?.data?.supportPhone ?? null))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const res = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, phone }),
      });
      const data = await res.json();
      if (data.success) {
        setOrder(data.data);
      } else {
        setError(data.error ?? "Order not found");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <div className="text-center">
        <div className="mx-auto w-fit rounded-2xl bg-brand-50 p-3 text-brand-600 dark:bg-brand-100">
          <PackageSearch className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">Track Your Order</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your order number and the mobile number you used at checkout.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 rounded-2xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="orderNumber">Order number *</Label>
            <Input
              id="orderNumber"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
              placeholder="SN100123"
              className="font-mono uppercase"
            />
          </div>
          <div>
            <Label htmlFor="phone">Mobile number *</Label>
            <Input
              id="phone"
              required
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
            />
          </div>
        </div>
        <Button type="submit" size="lg" className="mt-5 w-full rounded-xl" disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageSearch className="mr-2 h-4 w-4" />}
          Track Order
        </Button>
        {error && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
            {error}
          </p>
        )}
      </form>

      {order && (
        <div className="mt-8 space-y-5 animate-fade-in-up">
          {/* Summary card */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-lg font-bold">{order.orderNumber}</p>
                <p className="text-xs text-muted-foreground">Placed {formatDateTime(order.createdAt)}</p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>

            {order.courier && (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-muted/50 p-3.5 text-sm">
                <Truck className="h-4 w-4 text-brand-600" />
                <span className="font-medium">{order.courier}</span>
                {order.trackingNumber && (
                  <span className="font-mono text-muted-foreground">· {order.trackingNumber}</span>
                )}
              </div>
            )}
            {order.estimatedDelivery && order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
              <p className="mt-3 text-sm text-muted-foreground">
                Estimated delivery:{" "}
                <span className="font-semibold text-foreground">
                  {new Date(order.estimatedDelivery).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                </span>
              </p>
            )}

            <div className="mt-5 space-y-3">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.name} fill sizes="56px" className="object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Qty {item.quantity}
                      {item.options ? ` · ${Object.values(item.options).join(", ")}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{formatBDT(item.total)}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatBDT(order.subtotal)}</span></div>
              {order.discountTotal > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Discount</span><span>−{formatBDT(order.discountTotal)}</span></div>
              )}
              <div className="flex justify-between text-muted-foreground"><span>Shipping</span><span>{order.shippingTotal === 0 ? "FREE" : formatBDT(order.shippingTotal)}</span></div>
              <div className="flex justify-between font-bold"><span>Total ({PAYMENT_METHOD_LABELS[order.paymentMethod]})</span><span>{formatBDT(order.total)}</span></div>
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="mb-5 font-bold">Delivery progress</p>
            <OrderTimeline status={order.status} history={order.statusHistory} />
          </div>
        </div>
      )}

      {supportPhone && (
        <div className="mt-10 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          Need help? <span className="font-semibold text-brand-600">Call {supportPhone}</span> <ChevronRight className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}
