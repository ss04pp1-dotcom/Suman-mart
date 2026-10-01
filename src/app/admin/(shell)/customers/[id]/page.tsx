"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Phone, Receipt, Star, TrendingUp, Wallet } from "lucide-react";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { formatBDT, formatDate, formatDateTime, REVIEW_STATUS_LABELS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface CustomerDetail {
  id: string; name: string; email: string; phone: string; createdAt: string; isActive: boolean;
  addresses: { id: string; label: string; fullName: string; phone: string; line1: string; city: string; area: string | null; isDefault: boolean }[];
  orders: { id: string; orderNumber: string; status: string; paymentStatus: string; total: number; createdAt: string; items: { name: string; quantity: number }[] }[];
  reviews: { rating: number; comment: string; createdAt: string; product: { name: string } }[];
  summary: { totalOrders: number; totalSpent: number; aov: number; lastOrderAt: string | null };
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: customer, isLoading } = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/customers/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as CustomerDetail;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 rounded-2xl lg:col-span-2" /><Skeleton className="h-64 rounded-2xl" /></div>
      </div>
    );
  }
  if (!customer) return <p className="p-8 text-center text-muted-foreground">Customer not found.</p>;

  return (
    <div>
      <div className="mb-5 flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="rounded-xl">
          <Link href="/admin/customers" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand text-lg font-bold text-white">
            {customer.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
          </span>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{customer.name}</h2>
            <p className="text-sm text-muted-foreground">Customer since {formatDate(customer.createdAt)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Purchase summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total Orders", value: String(customer.summary.totalOrders), icon: Receipt, tone: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
              { label: "Total Spent", value: formatBDT(customer.summary.totalSpent), icon: Wallet, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
              { label: "Avg. Order", value: formatBDT(customer.summary.aov), icon: TrendingUp, tone: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <div className={`w-fit rounded-xl p-2 ${s.tone}`}><s.icon className="h-4 w-4" /></div>
                  <p className="mt-2.5 text-xl font-extrabold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Order history */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Order History</CardTitle></CardHeader>
            <CardContent className="p-0">
              {customer.orders.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="divide-y divide-border/60">
                  {customer.orders.map((o) => (
                    <Link key={o.id} href={`/admin/orders/${o.id}`} className="block p-4 transition-colors hover:bg-muted/40">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-bold text-brand-700 dark:text-brand-600">{o.orderNumber}</span>
                          <OrderStatusBadge status={o.status} />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold">{formatBDT(o.total)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(" · ")}</p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2.5 text-muted-foreground"><Mail className="h-4 w-4 text-brand-600" /> {customer.email}</p>
              <p className="flex items-center gap-2.5 text-muted-foreground"><Phone className="h-4 w-4 text-brand-600" /> {customer.phone ?? "—"}</p>
              <Separator />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved addresses</p>
              {customer.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved addresses.</p>
              ) : (
                customer.addresses.map((a) => (
                  <div key={a.id} className="rounded-xl bg-muted/50 p-3 text-sm">
                    <p className="flex items-center justify-between font-semibold">
                      {a.label}
                      {a.isDefault && <Badge className="bg-brand-50 text-brand-700 hover:bg-brand-50 dark:bg-brand-100 dark:text-brand-600">Default</Badge>}
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a.line1}, {a.area ? `${a.area}, ` : ""}{a.city}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recent Reviews</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {customer.reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reviews written.</p>
              ) : (
                customer.reviews.slice(0, 5).map((r, i) => (
                  <div key={i} className="rounded-xl border border-border/70 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">{r.product.name}</p>
                      <Badge variant="outline" className="gap-1 text-[10px]"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {r.rating}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.comment}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{formatDate(r.createdAt)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
