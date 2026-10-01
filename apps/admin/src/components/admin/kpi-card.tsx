"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  tone = "brand",
  loading,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "brand" | "amber" | "sky" | "rose" | "violet" | "emerald";
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-100",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="mt-4 h-7 w-24" />
          <Skeleton className="mt-2 h-3.5 w-20" />
        </CardContent>
      </Card>
    );
  }

  const showDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const positive = (delta ?? 0) > 0;
  const neutral = delta === 0;

  return (
    <Card className="transition-shadow hover:shadow-card">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={cn("rounded-xl p-2.5", tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
          {showDelta && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
                neutral
                  ? "bg-muted text-muted-foreground"
                  : positive
                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
              )}
            >
              {neutral ? <Minus className="h-3 w-3" /> : positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        <p className="mt-4 text-2xl font-extrabold tracking-tight">{value}</p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{deltaLabel ?? label}</p>
      </CardContent>
    </Card>
  );
}
