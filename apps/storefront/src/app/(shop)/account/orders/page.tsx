import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/auth";
import { formatBDT, formatDate } from "@/lib/format";
import { OrderStatusBadge } from "@/components/shop/order-timeline";
import { Button } from "@/components/ui/button";
import { ChevronRight, Package } from "lucide-react";

export default async function AccountOrdersPage() {
  const customer = await getCurrentCustomer();
  if (!customer) return null;

  const orders = await db.order.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { items: true },
  });

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-14 text-center">
        <Package className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <p className="text-lg font-bold">No orders yet</p>
          <p className="mt-1 text-sm text-muted-foreground">When you place an order it will show up here.</p>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/products">Start Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">My Orders</h1>
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/account/orders/${order.orderNumber}`}
          className="group block rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted/40">
                {order.items[0]?.imageUrl && (
                  <Image src={order.items[0].imageUrl} alt={order.items[0].name} fill sizes="56px" className="object-cover" />
                )}
              </div>
              <div>
                <p className="font-mono text-sm font-bold">{order.orderNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(order.createdAt)} · {order.items.reduce((n, i) => n + i.quantity, 0)} item(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-bold">{formatBDT(order.total)}</p>
                <OrderStatusBadge status={order.status} />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
          </div>
          {order.items.length > 1 && (
            <p className="mt-3 truncate border-t border-border/60 pt-3 text-xs text-muted-foreground">
              {order.items.map((i) => i.name).join(" · ")}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
