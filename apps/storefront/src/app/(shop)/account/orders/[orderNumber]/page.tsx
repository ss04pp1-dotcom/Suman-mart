import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { apiGet, type OrderRow } from "@/lib/backend-proxy";
import { parseJSON } from "@/lib/json";
import { formatBDT, formatDateTime, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { OrderTimeline, OrderStatusBadge } from "@/components/shop/order-timeline";
import { Truck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;

  const data = await apiGet<{ order: OrderRow }>(`/storefront/account/order/${orderNumber}`);
  if (!data) notFound();
  const order = { ...data.order, supplierOrders: data.order.supplierOrders ?? [], statusHistory: data.order.statusHistory ?? [] };

  const address = parseJSON<{ fullName: string; phone: string; line1: string; city: string; area?: string | null; postalCode?: string | null }>(
    order.shippingAddress,
    { fullName: order.customerName, phone: order.customerPhone, line1: "", city: "" }
  );

  return (
    <div className="space-y-5">
      <Button variant="ghost" asChild className="-ml-2 text-muted-foreground">
        <Link href="/account/orders"><ArrowLeft className="mr-2 h-4 w-4" /> All orders</Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-extrabold tracking-tight">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Placed {formatDateTime(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.courier && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-sm">
          <Truck className="h-4 w-4 text-brand-600" />
          <span className="font-medium">{order.courier}</span>
          {order.trackingNumber && <span className="font-mono text-muted-foreground">· {order.trackingNumber}</span>}
          {order.estimatedDelivery && order.status !== "DELIVERED" && (
            <span className="ml-auto text-xs text-muted-foreground">
              Est. delivery {new Date(order.estimatedDelivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-bold">Items ({order.items.length})</h2>
            <div className="mt-4 space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted/40">
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.name} fill sizes="64px" className="object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Qty {item.quantity}
                      {item.options ? ` · ${Object.values(parseJSON<Record<string, string>>(item.options, {})).join(", ")}` : ""}
                      {" · "}{formatBDT(item.unitPrice)} each
                    </p>
                  </div>
                  <p className="text-sm font-bold">{formatBDT(item.total)}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-1.5 border-t border-border pt-4 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatBDT(order.subtotal)}</span></div>
              {order.discountTotal > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Discount {order.couponCode && `(${order.couponCode})`}</span><span>−{formatBDT(order.discountTotal)}</span></div>
              )}
              <div className="flex justify-between text-muted-foreground"><span>Shipping</span><span>{order.shippingTotal === 0 ? "FREE" : formatBDT(order.shippingTotal)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-extrabold"><span>Total</span><span>{formatBDT(order.total)}</span></div>
            </div>
          </div>

          {order.supplierOrders.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-bold">Supplier fulfillment</h2>
              {order.supplierOrders.map((so) => (
                <div key={so.id} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3.5 text-sm">
                  <span className="font-semibold">{so.supplier.name}</span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {so.status}
                  </span>
                  {so.externalOrderId && <span className="font-mono text-xs text-muted-foreground">{so.externalOrderId}</span>}
                  {so.trackingNumber && (
                    <span className="ml-auto font-mono text-xs">{so.courier}: {so.trackingNumber}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-5 font-bold">Delivery progress</h2>
            <OrderTimeline
              status={order.status}
              history={order.statusHistory.map((h) => ({ status: h.status, note: h.note, createdAt: h.createdAt }))}
              compact
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 text-sm">
            <h2 className="font-bold">Delivery address</h2>
            <p className="mt-3 font-semibold">{address.fullName}</p>
            <p className="text-muted-foreground">{address.phone}</p>
            <p className="mt-1 text-muted-foreground">
              {address.line1}{address.area ? `, ${address.area}` : ""}, {address.city}{address.postalCode ? ` - ${address.postalCode}` : ""}
            </p>
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Payment</p>
              <p className="mt-1 font-semibold">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
              <p className="text-xs text-muted-foreground">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
