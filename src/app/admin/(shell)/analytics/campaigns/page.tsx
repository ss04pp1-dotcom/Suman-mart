"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, TrendingUp } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { HorizontalBarsChart } from "@/components/admin/charts";
import { KpiCard } from "@/components/admin/kpi-card";
import { formatBDT, formatCompact, formatPercent, TRAFFIC_SOURCE_LABELS } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CampaignRow {
  campaign: string; source: string; visitors: number; addToCart: number;
  checkout: number; purchases: number; revenue: number; conversionRate: number;
}

export default function CampaignsPage() {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "30d" });

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns", range],
    queryFn: async () => {
      const params = new URLSearchParams(range);
      const res = await fetch(`/api/admin/analytics/campaigns?${params}`);
      const json = await res.json();
      return json.data as CampaignRow[];
    },
  });

  const totals = (data ?? []).reduce(
    (acc, c) => ({
      visitors: acc.visitors + c.visitors,
      purchases: acc.purchases + c.purchases,
      revenue: acc.revenue + c.revenue,
    }),
    { visitors: 0, purchases: 0, revenue: 0 }
  );

  return (
    <div>
      <AdminPageHeader
        title="Campaigns"
        description="Performance by UTM campaign across all channels"
        actions={<DateRangeFilter range={range.range} from={range.from} to={range.to} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Campaign Visitors" value={formatCompact(totals.visitors)} icon={Megaphone} tone="sky" loading={isLoading} />
        <KpiCard label="Campaign Purchases" value={formatCompact(totals.purchases)} icon={TrendingUp} tone="brand" loading={isLoading} />
        <KpiCard label="Campaign Revenue" value={formatBDT(totals.revenue)} icon={TrendingUp} tone="emerald" loading={isLoading} />
        <KpiCard
          label="Blended CVR"
          value={formatPercent(totals.visitors > 0 ? (totals.purchases / totals.visitors) * 100 : 0, 2)}
          icon={Megaphone}
          tone="violet"
          loading={isLoading}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <HorizontalBarsChart
          title="Revenue by Campaign"
          description="Which campaigns drive sales"
          valuePrefix="৳"
          data={(data ?? []).slice(0, 8).map((c) => ({ name: c.campaign, value: c.revenue }))}
          loading={isLoading}
        />
        <HorizontalBarsChart
          title="Visitors by Campaign"
          description="Traffic volume per campaign"
          data={(data ?? []).slice(0, 8).map((c) => ({ name: c.campaign, value: c.visitors }))}
          loading={isLoading}
          color="#0d9488"
        />
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
            </div>
          ) : !data || data.length === 0 ? (
            <AdminEmptyState className="m-4" icon={Megaphone} title="No campaign traffic yet" description="Add UTM parameters to your marketing links to see campaign performance here." />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Add to Cart</TableHead>
                      <TableHead className="text-right">Checkout</TableHead>
                      <TableHead className="text-right">Purchases</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">CVR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((c) => (
                      <TableRow key={`${c.campaign}-${c.source}`}>
                        <TableCell className="font-mono text-sm font-semibold">{c.campaign}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] font-bold uppercase">{TRAFFIC_SOURCE_LABELS[c.source] ?? c.source}</Badge></TableCell>
                        <TableCell className="text-right text-sm">{c.visitors.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{c.addToCart}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{c.checkout}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{c.purchases}</TableCell>
                        <TableCell className="text-right text-sm font-bold">{formatBDT(c.revenue)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.conversionRate >= 10 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"}`}>
                            {c.conversionRate.toFixed(1)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {data.map((c) => (
                  <div key={`${c.campaign}-${c.source}`} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-mono text-sm font-semibold">{c.campaign}</p>
                      <Badge variant="outline" className="text-[10px] font-bold uppercase">{c.source}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div><p className="font-bold">{c.visitors}</p><p className="text-muted-foreground">visitors</p></div>
                      <div><p className="font-bold">{c.purchases}</p><p className="text-muted-foreground">purchases</p></div>
                      <div><p className="font-bold">{formatBDT(c.revenue)}</p><p className="text-muted-foreground">revenue</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
