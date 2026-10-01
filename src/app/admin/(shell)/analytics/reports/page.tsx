"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, Search, TrendingUp, ShoppingBag, Users, BarChart3, Activity, MousePointerClick, Truck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { HorizontalBarsChart } from "@/components/admin/charts";
import { formatBDT, formatCompact } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const REPORTS = [
  { type: "sales", label: "Sales Report", desc: "Daily revenue, orders, discounts and shipping", icon: TrendingUp },
  { type: "orders", label: "Orders Report", desc: "Complete order list with customer and payment details", icon: ShoppingBag },
  { type: "products", label: "Products Report", desc: "Units sold and revenue per product", icon: FileBarChart },
  { type: "customers", label: "Customers Report", desc: "Customer order counts and lifetime spend", icon: Users },
  { type: "suppliers", label: "Suppliers Report", desc: "Supplier order volume and cost", icon: Truck },
  { type: "campaigns", label: "Campaigns Report", desc: "Visitors, purchases and revenue per campaign", icon: BarChart3 },
  { type: "traffic", label: "Traffic Report", desc: "Visitors and purchases by traffic source", icon: MousePointerClick },
  { type: "conversion", label: "Conversion Report", desc: "Funnel steps with conversion and drop-off", icon: Activity },
  { type: "events", label: "Tracking Events Report", desc: "Raw vs deduplicated event counts", icon: Activity },
];

export default function ReportsPage() {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "30d" });

  const { data: searches } = useQuery({
    queryKey: ["search-analytics", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/searches?${params}`);
      const json = await res.json();
      return json.data as { query: string; count: number; avgResults: number; toView: number; toCart: number; toPurchase: number }[];
    },
  });

  const { data: abandoned } = useQuery({
    queryKey: ["abandoned", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/abandoned?${params}`);
      const json = await res.json();
      return json.data as { cartCreated: number; checkoutStarted: number; completed: number; abandoned: number; abandonedValue: number; topProducts: { productName: string; carts: number; value: number }[] };
    },
  });

  const exportUrl = (type: string) => {
    const params = new URLSearchParams(range);
    return `/api/admin/reports/export?type=${type}&${params}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Reports"
        description="Export data and explore search + abandoned cart insights"
        actions={<DateRangeFilter range={range.range} from={range.from} to={range.to} onChange={setRange} />}
      />

      {/* Export grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.type} className="group transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between">
                <div className="w-fit rounded-xl bg-brand-50 p-2.5 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-100">
                  <r.icon className="h-5 w-5" />
                </div>
                <Button variant="outline" size="sm" className="rounded-lg" asChild>
                  <a href={exportUrl(r.type)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                  </a>
                </Button>
              </div>
              <div>
                <p className="font-bold">{r.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Abandoned carts */}
      <div className="mt-8">
        <h3 className="mb-4 text-lg font-extrabold">Abandoned Carts</h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            ["Carts Created", abandoned?.cartCreated ?? 0, "text-sky-600"],
            ["Checkout Started", abandoned?.checkoutStarted ?? 0, "text-violet-600"],
            ["Completed", abandoned?.completed ?? 0, "text-emerald-600"],
            ["Abandoned", abandoned?.abandoned ?? 0, "text-rose-600"],
            ["Abandoned Value", formatBDT(abandoned?.abandonedValue ?? 0), "text-rose-600"],
          ].map(([label, value, cls]) => (
            <Card key={label as string}>
              <CardContent className="p-4">
                <p className={cn("text-2xl font-extrabold", cls as string)}>
                  {typeof value === "number" ? formatCompact(value) : value}
                </p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label as string}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {abandoned && abandoned.topProducts.length > 0 && (
          <div className="mt-4">
            <HorizontalBarsChart
              title="Most Abandoned Products"
              description="Products left in carts without purchase"
              valuePrefix="৳"
              data={abandoned.topProducts.slice(0, 6).map((p) => ({ name: p.productName, value: p.value }))}
            />
          </div>
        )}
      </div>

      {/* Search analytics */}
      <div className="mt-8">
        <h3 className="mb-1 text-lg font-extrabold">Search Analytics</h3>
        <p className="mb-4 text-sm text-muted-foreground">What customers search for — and whether they find it</p>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4 text-brand-600" /> Top Search Terms</CardTitle>
            <CardDescription>Search-to-view / cart / purchase conversion per term</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!searches ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
              </div>
            ) : searches.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No searches recorded in this period.</p>
            ) : (
              <div className="divide-y divide-border/60">
                <div className="hidden grid-cols-6 gap-3 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
                  <span>Term</span><span className="text-right">Searches</span><span className="text-right">Avg Results</span><span className="text-right">→ Views</span><span className="text-right">→ Carts</span><span className="text-right">→ Purchases</span>
                </div>
                {searches.slice(0, 15).map((s) => (
                  <div key={s.query} className="grid grid-cols-2 gap-3 px-5 py-3 text-sm md:grid-cols-6">
                    <span className="font-mono font-semibold">&ldquo;{s.query}&rdquo;</span>
                    <span className="text-right font-semibold">{s.count}</span>
                    <span className={cn("text-right", s.avgResults === 0 ? "font-semibold text-rose-500" : "text-muted-foreground")}>
                      {s.avgResults}{s.avgResults === 0 ? " (no results!)" : ""}
                    </span>
                    <span className="text-right text-muted-foreground">{s.toView}</span>
                    <span className="text-right text-muted-foreground">{s.toCart}</span>
                    <span className="text-right font-semibold text-emerald-600">{s.toPurchase}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted-foreground">
          Tip: terms with <strong className="text-rose-500">0 results</strong> are demand you are not serving yet —
          consider adding those products. <Link href="/admin/analytics" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">Back to analytics →</Link>
        </p>
      </div>
    </div>
  );
}
