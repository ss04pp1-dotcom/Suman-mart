"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Eye, Globe2, MonitorSmartphone, MousePointerClick, Receipt, Search,
  ShoppingBag, Smartphone, TrendingUp, Users, Zap, Gauge, BadgeDollarSign, Cookie,
} from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { TrafficRevenueChart, DonutChart, HorizontalBarsChart } from "@/components/admin/charts";
import { ConversionFunnel } from "@/components/admin/funnel";
import { LiveActivityPanel } from "@/components/admin/live-activity";
import { PixelHealthStrip } from "@/components/admin/pixel-health";
import { AdminPageHeader } from "@/components/admin/page-header";
import { formatBDT, formatCompact, formatPercent, EVENT_LABELS, TRAFFIC_SOURCE_LABELS, DEVICE_LABELS, timeAgo } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface OverviewData {
  kpis: {
    visitors: number; pageViews: number; productViews: number; searches: number; addToCart: number;
    checkoutStarted: number; paymentAttempts: number; purchases: number; revenue: number;
    conversionRate: number; aov: number; abandonedCarts: number; abandonedValue: number;
    returningVisitors: number; newVisitors: number; orders: number; pendingOrders: number;
  };
  series: { date: string; sessions: number; orders: number; revenue: number }[];
  sources: { source: string; visitors: number; purchases: number; revenue: number }[];
  devices: { device: string; visitors: number; share: number }[];
  browsers: { name: string; count: number }[];
  oses: { name: string; count: number }[];
  geo: { country: string; visitors: number }[];
  eventCounts: { name: string; count: number; deduped: number }[];
}

interface ConsentData {
  total: number; acceptAll: number; essentialOnly: number; custom: number; rejected: number;
  analyticsAllowed: number; marketingAllowed: number;
}

export default function AnalyticsOverviewPage() {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "30d" });

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/overview?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as OverviewData;
    },
  });

  const { data: funnel } = useQuery({
    queryKey: ["analytics-funnel", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/funnel?${params}`);
      const json = await res.json();
      return json.data as { name: string; label: string; count: number; conversion: number; dropOff: number }[];
    },
  });

  const { data: consent } = useQuery({
    queryKey: ["analytics-consent", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/consent?${params}`);
      const json = await res.json();
      return json.data as ConsentData;
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ["analytics-campaigns-top", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/campaigns?${params}`);
      const json = await res.json();
      return (json.data as { campaign: string; source: string; visitors: number; purchases: number; revenue: number; conversionRate: number }[]).slice(0, 6);
    },
  });

  const { data: topProducts } = useQuery({
    queryKey: ["analytics-products", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/products?${params}&take=6`);
      const json = await res.json();
      return json.data as { productId: string; name: string; slug: string; views: number; addToCart: number; purchases: number; revenue: number; conversionRate: number }[];
    },
  });

  const { data: recentEvents } = useQuery({
    queryKey: ["analytics-recent-events"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/events?limit=8");
      const json = await res.json();
      return (json.data?.items ?? []) as { id: string; name: string; productName: string | null; searchQuery: string | null; value: number | null; source: string; device: string | null; createdAt: string }[];
    },
    refetchInterval: 15000,
  });

  const k = data?.kpis;

  return (
    <div>
      <AdminPageHeader
        title="Analytics Overview"
        description="Traffic, conversion and revenue intelligence"
        actions={<DateRangeFilter range={range.range} from={range.from} to={range.to} onChange={setRange} />}
      />

      {/* 1 — KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Visitors" value={formatCompact(k?.visitors ?? 0)} icon={Users} tone="sky" loading={isLoading} />
        <KpiCard label="Page Views" value={formatCompact(k?.pageViews ?? 0)} icon={Eye} tone="brand" loading={isLoading} />
        <KpiCard label="Product Views" value={formatCompact(k?.productViews ?? 0)} icon={MousePointerClick} tone="violet" loading={isLoading} />
        <KpiCard label="Searches" value={formatCompact(k?.searches ?? 0)} icon={Search} tone="amber" loading={isLoading} />
        <KpiCard label="Add to Cart" value={formatCompact(k?.addToCart ?? 0)} icon={ShoppingBag} tone="emerald" loading={isLoading} />
        <KpiCard label="Checkout Started" value={formatCompact(k?.checkoutStarted ?? 0)} icon={Zap} tone="sky" loading={isLoading} />
        <KpiCard label="Purchases" value={formatCompact(k?.purchases ?? 0)} icon={Receipt} tone="brand" loading={isLoading} />
        <KpiCard label="Revenue" value={formatBDT(k?.revenue ?? 0)} icon={BadgeDollarSign} tone="emerald" loading={isLoading} />
        <KpiCard label="Conversion Rate" value={formatPercent(k?.conversionRate ?? 0, 2)} icon={Gauge} tone="violet" loading={isLoading} />
        <KpiCard label="Avg. Order Value" value={formatBDT(k?.aov ?? 0)} icon={TrendingUp} tone="brand" loading={isLoading} />
        <KpiCard label="Abandoned Carts" value={formatCompact(k?.abandonedCarts ?? 0)} icon={ShoppingBag} tone="rose" loading={isLoading} />
        <KpiCard
          label="Returning Visitors"
          value={formatCompact(k?.returningVisitors ?? 0)}
          icon={Users}
          tone="amber"
          loading={isLoading}
          deltaLabel={`${formatCompact(k?.newVisitors ?? 0)} new visitors`}
        />
      </div>

      {/* 2 — Traffic + revenue chart */}
      <div className="mt-6">
        <TrafficRevenueChart data={data?.series ?? []} loading={isLoading} />
      </div>

      {/* 3 — Conversion funnel */}
      <div className="mt-4">
        <ConversionFunnel steps={funnel ?? []} loading={!funnel} />
      </div>

      {/* 4 — Traffic sources + devices */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <DonutChart
          title="Traffic Sources"
          description="Visitors by channel"
          data={(data?.sources ?? []).map((s) => ({ name: TRAFFIC_SOURCE_LABELS[s.source] ?? s.source, value: s.visitors }))}
          loading={isLoading}
        />
        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="h-4 w-4 text-brand-600" /> Devices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.devices ?? []).map((d) => (
                <div key={d.device}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {d.device === "MOBILE" ? <Smartphone className="h-3.5 w-3.5" /> : <MonitorSmartphone className="h-3.5 w-3.5" />}
                      {DEVICE_LABELS[d.device] ?? d.device}
                    </span>
                    <span className="text-muted-foreground">{d.visitors.toLocaleString()} · {d.share.toFixed(1)}%</span>
                  </div>
                  <Progress value={d.share} className="h-2" />
                </div>
              ))}
              {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4 text-brand-600" /> Top Countries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(data?.geo ?? []).slice(0, 5).map((g) => (
                <div key={g.country} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{g.country}</span>
                  <span className="text-muted-foreground">{g.visitors.toLocaleString()}</span>
                </div>
              ))}
              {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </CardContent>
          </Card>
        </div>
        <HorizontalBarsChart
          title="Browsers"
          description="Top browsers"
          data={(data?.browsers ?? []).map((b) => ({ name: b.name, value: b.count }))}
          loading={isLoading}
          color="#0d9488"
        />
      </div>

      {/* 5 — Top products + campaigns */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Products</CardTitle>
            <CardDescription>Views, carts, purchases and revenue</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {(topProducts ?? []).map((p, i) => (
                <div key={p.productId} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${i === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.views.toLocaleString()} views · {p.addToCart} carts · {p.purchases} purchases</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{formatBDT(p.revenue)}</p>
                    <p className="text-xs text-emerald-600">{p.conversionRate.toFixed(1)}% CVR</p>
                  </div>
                </div>
              ))}
              {(!topProducts) && Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-5 py-3"><Skeleton className="h-10 w-full" /></div>)}
            </div>
            <Link href="/admin/analytics/reports" className="block border-t border-border p-3 text-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-600">
              Compare products in Reports →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Campaign Performance</CardTitle>
            <CardDescription>UTM-tracked campaigns by conversions</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {(campaigns ?? []).map((c) => (
                <div key={c.campaign} className="flex items-center gap-3 px-5 py-3.5">
                  <Badge variant="outline" className="shrink-0 text-[10px] font-bold uppercase">{c.source}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-semibold">{c.campaign}</p>
                    <p className="text-xs text-muted-foreground">{c.visitors} visitors · {c.purchases} purchases</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{formatBDT(c.revenue)}</p>
                    <p className="text-xs text-emerald-600">{c.conversionRate.toFixed(1)}% CVR</p>
                  </div>
                </div>
              ))}
              {!campaigns && Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-5 py-3"><Skeleton className="h-10 w-full" /></div>)}
            </div>
            <Link href="/admin/analytics/campaigns" className="block border-t border-border p-3 text-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-600">
              All campaigns →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* 6 — Live activity + cookie consent */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <LiveActivityPanel />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cookie className="h-4 w-4 text-amber-500" /> Cookie Consent
            </CardTitle>
            <CardDescription>Privacy choices by storefront visitors</CardDescription>
          </CardHeader>
          <CardContent>
            {consent ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Accept All", consent.acceptAll, "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"],
                    ["Essential Only", consent.essentialOnly, "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"],
                    ["Custom", consent.custom, "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400"],
                    ["Rejected", consent.rejected, "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"],
                  ].map(([label, value, cls]) => (
                    <div key={label as string} className={`rounded-xl p-3.5 ${cls as string}`}>
                      <p className="text-2xl font-extrabold">{(value as number).toLocaleString()}</p>
                      <p className="text-xs font-semibold">{label as string}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2.5 rounded-xl bg-muted/50 p-4 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Analytics cookies allowed</span><span className="font-semibold">{consent.analyticsAllowed.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Marketing cookies allowed</span><span className="font-semibold">{consent.marketingAllowed.toLocaleString()}</span></div>
                  <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Total decisions</span><span className="font-bold">{consent.total.toLocaleString()}</span></div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 7 — Pixel health */}
      <div className="mt-4">
        <PixelHealthStrip />
      </div>

      {/* 8 — Recent event logs */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-brand-600" /> Recent Events</CardTitle>
              <CardDescription>Latest tracked events (updates every 15s)</CardDescription>
            </div>
            <Link href="/admin/analytics/events" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-600">
              View all event logs →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {(recentEvents ?? []).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2.5 px-5 py-3 text-sm">
                <Badge className="bg-brand-50 text-brand-700 hover:bg-brand-50 dark:bg-brand-100 dark:text-brand-600">
                  {EVENT_LABELS[e.name] ?? e.name}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {e.productName ?? e.searchQuery ?? "—"}
                </span>
                {e.value ? <span className="font-semibold">{formatBDT(e.value)}</span> : null}
                <Badge variant="outline" className="text-[10px] font-bold uppercase">{e.source}</Badge>
                <span className="w-20 text-right text-xs text-muted-foreground">{e.device?.toLowerCase()}</span>
                <span className="w-16 text-right text-xs text-muted-foreground">{timeAgo(e.createdAt)}</span>
              </div>
            ))}
            {!recentEvents && Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-5 py-3"><Skeleton className="h-6 w-full" /></div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
