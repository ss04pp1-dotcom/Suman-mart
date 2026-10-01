"use client";

import { use, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Boxes, Download, Import, Link2, PackageCheck, RefreshCw, ScrollText, Truck, Loader2,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { formatBDT, formatDateTime, timeAgo } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SupplierProduct {
  id: string; externalId: string; name: string; price: number; stock: number; sku: string | null;
  category: string | null; images: string[]; lastSyncedAt: string;
  linkedProduct: { id: string; name: string; slug: string; price: number; stock: number; imageUrl: string | null } | null;
}
interface SupplierOrderRow {
  id: string; status: string; externalOrderId: string | null; itemsTotal: number; shippingFee: number;
  total: number; trackingNumber: string | null; courier: string | null; createdAt: string;
  order: { orderNumber: string; status: string; customerName: string; total: number };
}
interface SyncLog {
  id: string; type: string; status: string; message: string | null; itemsProcessed: number;
  itemsCreated: number; itemsUpdated: number; itemsFailed: number; durationMs: number; createdAt: string;
}
interface SupplierDetail {
  id: string; name: string; code: string; email: string | null; phone: string | null; adapter: string;
  autoSyncPrice: boolean; autoSyncStock: boolean; isActive: boolean; notes: string | null;
  lastSyncAt: string | null; config: { markupPercent?: number };
  products: SupplierProduct[];
  syncLogs: SyncLog[];
  orders: SupplierOrderRow[];
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ["admin-supplier", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/suppliers/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as SupplierDetail;
    },
  });

  const sync = async (type: "PRODUCTS" | "PRICES" | "STOCK") => {
    setBusy(type);
    try {
      const res = await fetch(`/api/admin/suppliers/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (json.success) {
        const o = json.data;
        toast[o.status === "FAILED" ? "error" : "success"](o.message);
        queryClient.invalidateQueries({ queryKey: ["admin-supplier", id] });
        queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
      } else toast.error(json.error);
    } finally {
      setBusy(null);
    }
  };

  const importProduct = async (supplierProductId: string) => {
    setBusy(supplierProductId);
    try {
      const res = await fetch("/api/admin/suppliers/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: id, supplierProductId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.data.created ? `Imported to store: ${json.data.slug}` : "Already linked to a product");
        queryClient.invalidateQueries({ queryKey: ["admin-supplier", id] });
        queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      } else toast.error(json.error);
    } finally {
      setBusy(null);
    }
  };

  const refreshOrder = async (orderId: string) => {
    setBusy(orderId);
    try {
      const res = await fetch(`/api/admin/suppliers/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.data.statusChanged ? "Supplier status changed" : "No status change");
        queryClient.invalidateQueries({ queryKey: ["admin-supplier", id] });
      } else toast.error(json.error);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !supplier) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const linkedCount = supplier.products.filter((p) => p.linkedProduct).length;
  const unlinked = supplier.products.filter((p) => !p.linkedProduct);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-xl">
            <Link href="/admin/suppliers" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight">{supplier.name}</h2>
                <Badge variant="outline" className="font-mono">{supplier.code}</Badge>
                <Badge className={supplier.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                  {supplier.isActive ? "Active" : "Disabled"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {supplier.adapter} · markup {supplier.config.markupPercent ?? 25}% · last sync {supplier.lastSyncAt ? timeAgo(supplier.lastSyncAt) : "never"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="rounded-xl" onClick={() => sync("PRODUCTS")} disabled={Boolean(busy)}>
            {busy === "PRODUCTS" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync Products
          </Button>
          <Button variant="outline" className="rounded-xl bg-card" onClick={() => sync("PRICES")} disabled={Boolean(busy)}>Sync Prices</Button>
          <Button variant="outline" className="rounded-xl bg-card" onClick={() => sync("STOCK")} disabled={Boolean(busy)}>Sync Stock</Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Catalog items", value: String(supplier.products.length), icon: Boxes },
          { label: "Linked to store", value: String(linkedCount), icon: Link2 },
          { label: "Dropship orders", value: String(supplier.orders.length), icon: PackageCheck },
          { label: "Auto sync", value: `${supplier.autoSyncPrice ? "price" : ""}${supplier.autoSyncPrice && supplier.autoSyncStock ? " + " : ""}${supplier.autoSyncStock ? "stock" : ""}` || "manual", icon: RefreshCw },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground"><stat.icon className="h-4 w-4" /><span className="text-xs font-medium">{stat.label}</span></div>
              <p className="mt-2 text-xl font-extrabold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {supplier.notes && (
        <Card className="mb-5 border-violet-200 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-950/20">
          <CardContent className="p-4 text-sm text-muted-foreground">{supplier.notes}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="products">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 no-scrollbar sm:w-fit">
          <TabsTrigger value="products" className="rounded-xl px-4 py-2 text-sm">Catalog ({supplier.products.length})</TabsTrigger>
          <TabsTrigger value="unlinked" className="rounded-xl px-4 py-2 text-sm">To Import ({unlinked.length})</TabsTrigger>
          <TabsTrigger value="orders" className="rounded-xl px-4 py-2 text-sm">Supplier Orders ({supplier.orders.length})</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-xl px-4 py-2 text-sm">Sync Logs ({supplier.syncLogs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier item</TableHead>
                    <TableHead>External ID</TableHead>
                    <TableHead className="text-right">Wholesale</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Linked store product</TableHead>
                    <TableHead className="text-right">Retail</TableHead>
                    <TableHead>Last synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.products.filter((p) => p.linkedProduct).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                            {p.images[0] ? <Image src={p.images[0]} alt={p.name} fill sizes="40px" className="object-cover" /> : null}
                          </div>
                          <span className="max-w-[220px] truncate text-sm font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{p.externalId}</Badge></TableCell>
                      <TableCell className="text-right text-sm">{formatBDT(p.price)}</TableCell>
                      <TableCell className="text-right text-sm">{p.stock}</TableCell>
                      <TableCell>
                        <Link href={`/admin/products/${p.linkedProduct!.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-600">
                          <Link2 className="h-3.5 w-3.5" /> {p.linkedProduct!.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{formatBDT(p.linkedProduct!.price)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(p.lastSyncedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unlinked" className="mt-4">
          {unlinked.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              All catalog items are linked to store products. Run a product sync to pull new supplier items.
            </CardContent></Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {unlinked.map((p) => (
                <Card key={p.id}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{p.name}</p>
                        <Badge variant="outline" className="mt-1 font-mono text-[10px]">{p.externalId}</Badge>
                      </div>
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted/40">
                        {p.images[0] ? <Image src={p.images[0]} alt={p.name} fill sizes="56px" className="object-cover" /> : null}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <div>
                        <p className="font-bold">{formatBDT(p.price)}</p>
                        <p className="text-xs text-muted-foreground">wholesale</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-brand-700 dark:text-brand-600">{formatBDT(Math.round((p.price * (100 + (supplier.config.markupPercent ?? 25))) / 100))}</p>
                        <p className="text-xs text-muted-foreground">with markup</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{p.stock}</p>
                        <p className="text-xs text-muted-foreground">in stock</p>
                      </div>
                    </div>
                    <Button className="mt-4 w-full rounded-xl" onClick={() => importProduct(p.id)} disabled={busy === p.id}>
                      {busy === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
                      Import to Store
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier order</TableHead>
                    <TableHead>Customer order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tracking</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Placed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell><span className="font-mono text-xs font-semibold">{o.externalOrderId ?? "—"}</span></TableCell>
                      <TableCell>
                        <Link href={`/admin/orders/${o.order.orderNumber}`} className="font-mono text-xs font-bold text-brand-700 hover:underline dark:text-brand-600">
                          {o.order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{o.order.customerName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{o.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.trackingNumber ? `${o.courier} · ${o.trackingNumber}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{formatBDT(o.total)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => refreshOrder(o.id)} disabled={busy === o.id}>
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === o.id ? "animate-spin" : ""}`} /> Refresh
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4 text-brand-600" /> Sync History</CardTitle>
              <CardDescription>Automation audit trail for this supplier</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {supplier.syncLogs.map((log) => (
                  <div key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
                    <Badge variant="outline" className="text-[10px] font-bold uppercase">{log.type}</Badge>
                    <Badge className={
                      log.status === "SUCCESS" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : log.status === "PARTIAL" ? "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400"
                      : "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400"
                    }>{log.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{log.message}</span>
                    <span className="text-xs text-muted-foreground">{log.itemsProcessed} items · {(log.durationMs / 1000).toFixed(1)}s</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
