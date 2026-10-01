"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/lib/format";

export interface FunnelStepData {
  name: string;
  label: string;
  count: number;
  conversion: number;
  dropOff: number;
}

export function ConversionFunnel({ steps, loading }: { steps: FunnelStepData[]; loading?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversion Funnel</CardTitle>
          <CardDescription>From first visit to completed purchase</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const visible = expanded ? steps : steps.slice(0, 4);
  const max = Math.max(...steps.map((s) => s.count), 1);
  const overallConversion = steps.length > 0 ? (steps[steps.length - 1].count / (steps[0].count || 1)) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Conversion Funnel</CardTitle>
        <CardDescription>
          From first visit to completed purchase ·{" "}
          <span className="font-semibold text-brand-700 dark:text-brand-600">{overallConversion.toFixed(2)}% overall</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {visible.map((step, i) => {
          const width = Math.max(4, (step.count / max) * 100);
          const prev = i > 0 ? steps[i - 1].count : step.count;
          return (
            <div key={step.name}>
              {i > 0 && (
                <div className="flex items-center gap-2 py-0.5 pl-4 text-[11px] text-muted-foreground">
                  <ChevronDown className="h-3 w-3" />
                  <span className={cn("font-semibold", step.dropOff > 60 ? "text-rose-500" : "text-muted-foreground")}>
                    {step.conversion.toFixed(1)}% continue · {step.dropOff.toFixed(1)}% drop off
                  </span>
                  <span className="text-rose-400">−{formatCompact(Math.max(0, prev - step.count))}</span>
                </div>
              )}
              <div className="group relative overflow-hidden rounded-xl bg-muted/50 px-4 py-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r from-brand-600 to-teal-500/80 opacity-90 transition-all duration-500"
                  style={{ width: `${width}%` }}
                />
                <div className="relative flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white mix-blend-luminosity">
                    <Users className="h-3.5 w-3.5" />
                    {step.label}
                  </span>
                  <span className="text-sm font-bold text-white mix-blend-luminosity">
                    {step.count.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {!expanded && steps.length > 4 && (
          <button
            onClick={() => setExpanded(true)}
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            Show {steps.length - 4} more steps <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
