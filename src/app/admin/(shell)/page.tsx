"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, BadgeDollarSign, Package, Receipt, ShoppingBag,
  TrendingUp, Users, Gauge,
} from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { TrafficRevenueChart, OrdersChart, DonutChart, HorizontalBarsChart } from "@/components/admin/charts";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/status-badge";
import { AdminPageHeader } from "@/components/admin/page-header";
import { formatBDT, formatCompact, formatDateTime, TRAFFIC_SOURCE_LABELS } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardData {
  kpis: {
    totalSales: number; revenueDelta: number; totalOrders: number; ordersDelta: number;
    pendingOrders: number; totalCustomers: number; totalProducts: number; lowStockCount: number;
    conversionRate: number; aov: number; aovDelta: number; deliveredOrders: number; deliveredDelta: number;
  };
  salesSeries: { date: string; orders: number; revenue: number; sessions: number }[];
  topProducts: { name: string; slug: string; qty: number; revenue: number }[];
  recentOrders: { id: string; orderNumber: string; customerName: string; total: number; status: string; paymentStatus: string; createdAt: string }[];
  trafficSources: { source: string; visitors: number }[];
  lowStock: { id: string; name: string; stock: number; lowStockThreshold: number; slug: string }[];
}

export default function AdminDashboardPage() {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "30d" });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/dashboard?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as DashboardData;
    },
  });

  const k = data?.kpis;

  return (
    <div>
      <AdminPageHeader
        title="Dashboard"
        description="Store performance at a glance"
        actions={<DateRangeFilter range={range.range} from={range.from} to={range.to} onChange={setRange} />}
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Sales" value={formatBDT(k?.totalSales ?? 0)} delta={k?.revenueDelta} icon={BadgeDollarSign} tone="brand" loading={isLoading} />
        <KpiCard label="Total Orders" value={formatCompact(k?.totalOrders ?? 0)} delta={k?.ordersDelta} icon={Receipt} tone="sky" loading={isLoading} />
        <KpiCard label="Avg. Order Value" value={formatBDT(k?.aov ?? 0)} delta={k?.aovDelta} icon={TrendingUp} tone="emerald" loading={isLoading} />
        <KpiCard label="Conversion Rate" value={`${(k?.conversionRate ?? 0).toFixed(2)}%`} icon={Gauge} tone="violet" loading={isLoading} />
        <KpiCard label="Pending Orders" value={formatCompact(k?.pendingOrders ?? 0)} icon={ShoppingBag} tone="amber" loading={isLoading} />
        <KpiCard label="Total Customers" value={formatCompact(k?.totalCustomers ?? 0)} icon={Users} tone="sky" loading={isLoading} />
        <KpiCard label="Total Products" value={formatCompact(k?.totalProducts ?? 0)} icon={Package} tone="brand" loading={isLoading} />
        <KpiCard
          label="Low Stock Items"
          value={formatCompact(k?.lowStockCount ?? 0)}
          icon={AlertTriangle}
          tone={(k?.lowStockCount ?? 0) > 0 ? "rose" : "emerald"}
          loading={isLoading}
        />
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrafficRevenueChart data={data?.salesSeries ?? []} loading={isLoading} />
        </div>
        <DonutChart
          title="Traffic Sources"
          description="Where visitors come from"
          data={(data?.trafficSources ?? []).map((s) => ({ name: TRAFFIC_SOURCE_LABELS[s.source] ?? s.source, value: s.visitors }))}
          loading={isLoading}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <OrdersChart data={data?.salesSeries ?? []} loading={isLoading} />
        <HorizontalBarsChart
          title="Top Products"
          description="By revenue in this period"
          valuePrefix="৳"
          data={(data?.topProducts ?? []).map((p) => ({ name: p.name.length > 24 ? `${p.name.slice(0, 24)}…` : p.name, value: p.revenue }))}
          loading={isLoading}
        />
        {/* Low stock alert card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Stock
            </CardTitle>
            <CardDescription>Items at or below their threshold</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : !data || data.lowStock.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">All stock levels are healthy 🎉</p>
            ) : (
              <div className="space-y-2">
                {data.lowStock.slice(0, 5).map((p) => (
                  <Link
                    key={p.id}
                    href={`/admin/products/${p.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border/70 p-3 transition-colors hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-950/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">Threshold: {p.lowStockThreshold}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.stock === 0 ? "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"}`}>
                      {p.stock === 0 ? "Out" : `${p.stock} left`}
                    </span>
                  </Link>
                ))}
                <Link href="/admin/products?stock=low" className="flex items-center justify-center gap-1 pt-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-600">
                  View all low stock <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent orders */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Orders</CardTitle>
              <CardDescription>The latest orders placed on your store</CardDescription>
            </div>
            <Link href="/admin/orders" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-600">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                : (data?.recentOrders ?? []).map((order) => (
                    <TableRow key={order.id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-mono text-sm font-bold text-brand-700 hover:underline dark:text-brand-600">
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{order.customerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</TableCell>
                      <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                      <TableCell><PaymentStatusBadge status={order.paymentStatus} /></TableCell>
                      <TableCell className="text-right font-semibold">{formatBDT(order.total)}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="p-4"><Skeleton className="h-14 w-full" /></div>)
              : (data?.recentOrders ?? []).map((order) => (
                  <Link key={order.id} href={`/admin/orders/${order.id}`} className="block p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold">{order.orderNumber}</span>
                      <span className="text-sm font-bold">{formatBDT(order.total)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{order.customerName}</span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                  </Link>
                ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
