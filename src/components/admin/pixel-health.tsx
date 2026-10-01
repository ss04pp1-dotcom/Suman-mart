"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

interface Integration {
  provider: string;
  config: { [key: string]: string | undefined };
  isEnabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  hasAccessToken: boolean;
  hasApiSecret: boolean;
}

const PROVIDER_META: Record<string, { label: string; browserLabel: string; serverLabel: string }> = {
  META: { label: "Meta", browserLabel: "Meta Pixel", serverLabel: "Conversions API" },
  GOOGLE: { label: "Google", browserLabel: "GA4 Tag", serverLabel: "Measurement Protocol" },
  TIKTOK: { label: "TikTok", browserLabel: "TikTok Pixel", serverLabel: "Events API" },
  CUSTOM: { label: "Custom", browserLabel: "Webhook", serverLabel: "Server Forwarding" },
};

function IntegrationChip({ integration }: { integration: Integration }) {
  const meta = PROVIDER_META[integration.provider] ?? { label: integration.provider, browserLabel: "Pixel", serverLabel: "Server" };
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);

  const configured = Boolean(
    integration.provider === "GOOGLE" ? integration.config.ga4MeasurementId : integration.config.pixelId ?? integration.config.endpoint
  );
  const serverConfigured =
    integration.hasAccessToken || integration.hasApiSecret || integration.provider === "CUSTOM" ? integration.hasAccessToken || integration.hasApiSecret : false;

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/test-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: integration.provider }),
      });
      const data = await res.json();
      if (data.success && data.data.ok) toast.success(`${meta.label}: ${data.data.message}`);
      else toast.error(`${meta.label}: ${data.data?.message ?? "Test failed"}`);
      queryClient.invalidateQueries({ queryKey: ["pixel-health"] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {integration.isEnabled && configured ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-slate-300 dark:text-slate-600" />
        )}
        {meta.browserLabel}
      </div>
      <span className="text-xs text-muted-foreground">
        {integration.isEnabled && configured ? "Connected" : integration.isEnabled ? "Enabled — not configured" : "Disabled"}
      </span>
      <span className="text-border">·</span>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{meta.serverLabel}:</span>
        {serverConfigured ? (
          <Badge className={cn("text-[11px]", integration.status === "ERROR" ? "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400")}>
            {integration.status === "ERROR" ? "Error" : "Connected"}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] text-muted-foreground">Not configured</Badge>
        )}
      </div>
      {integration.lastCheckedAt && (
        <span className="text-[11px] text-muted-foreground">checked {timeAgo(integration.lastCheckedAt)}</span>
      )}
      <button
        onClick={test}
        disabled={testing}
        className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 dark:text-brand-600 dark:hover:bg-brand-100"
      >
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Test
      </button>
    </div>
  );
}

export function PixelHealthStrip() {
  const { data, isLoading } = useQuery({
    queryKey: ["pixel-health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/settings?key=tracking");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { meta: Integration; google: Integration; tiktok: Integration; custom: Integration };
    },
  });

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-bold">Pixel Health</p>
        {isLoading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            <IntegrationChip integration={data.meta} />
            <IntegrationChip integration={data.google} />
            <IntegrationChip integration={data.tiktok} />
            <IntegrationChip integration={data.custom} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
