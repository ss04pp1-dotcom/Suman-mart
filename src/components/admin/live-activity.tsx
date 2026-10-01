"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Eye, MousePointerClick, Search, ShoppingBag, UserPlus, Zap } from "lucide-react";
import { EVENT_LABELS, timeAgo, formatBDT } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LiveItem {
  id: string;
  name: string;
  label: string;
  productName: string | null;
  value: number | null;
  device: string | null;
  source: string | null;
  createdAt: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ViewContent: Eye,
  AddToCart: ShoppingBag,
  InitiateCheckout: Zap,
  Purchase: ShoppingBag,
  Search: Search,
  AddToWishlist: UserPlus,
};

export function LiveActivityPanel({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["live-activity"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/live?take=15");
      const json = await res.json();
      return json.success ? (json.data as LiveItem[]) : [];
    },
    refetchInterval: 8000, // Near-real-time
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Live Activity
        </CardTitle>
        <CardDescription>What shoppers are doing right now</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={cn("space-y-1 overflow-y-auto refined-scroll", compact ? "max-h-72" : "max-h-96")}>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)
          ) : !data || data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No recent activity — waiting for visitors…</p>
          ) : (
            data.map((item) => {
              const Icon = ICONS[item.name] ?? Activity;
              return (
                <div key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60">
                  <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-semibold">{EVENT_LABELS[item.name] ?? item.name}</span>
                    {item.productName && (
                      <span className="text-muted-foreground"> — {item.label} {item.productName}</span>
                    )}
                    {item.name === "InitiateCheckout" && !item.productName && (
                      <span className="text-muted-foreground"> — {item.label}</span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    {item.device && (
                      <span className="hidden rounded-full bg-muted px-2 py-0.5 font-medium sm:inline">
                        {item.device.toLowerCase()}
                      </span>
                    )}
                    {item.value ? <span className="font-semibold text-foreground">{formatBDT(item.value)}</span> : null}
                    <span className="w-12 text-right">{timeAgo(item.createdAt)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <MousePointerClick className="h-3 w-3" />
          Updates every 8 seconds · privacy-safe aggregated data
        </p>
      </CardContent>
    </Card>
  );
}
