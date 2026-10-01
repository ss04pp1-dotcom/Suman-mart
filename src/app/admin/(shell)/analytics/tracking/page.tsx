"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Eye, EyeOff, Loader2, Plug, Save, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PixelHealthStrip } from "@/components/admin/pixel-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface Integration {
  provider: string;
  config: { [key: string]: string | undefined };
  isEnabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  hasAccessToken: boolean;
  hasApiSecret: boolean;
  testEventCode?: string;
}

function IntegrationEditor({ integration }: { integration: Integration }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(integration.isEnabled);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    setForm(Object.fromEntries(Object.entries(integration.config).map(([k, v]) => [k, v ?? ""])));
    setSecrets({ accessToken: "", apiSecret: "", testEventCode: integration.testEventCode ?? "" });
    setEnabled(integration.isEnabled);
  }, [integration]);

  const save = async () => {
    setSaving(true);
    try {
      const configPayload: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(form)) {
        if (v.trim()) configPayload[k] = v.trim();
        else if (integration.config[k]) configPayload[k] = "";
      }
      const secretPayload: Record<string, string | undefined> = {};
      if (secrets.accessToken.trim()) secretPayload.accessToken = secrets.accessToken.trim();
      if (secrets.apiSecret?.trim()) secretPayload.apiSecret = secrets.apiSecret.trim();
      if (secrets.testEventCode !== (integration.testEventCode ?? "")) secretPayload.testEventCode = secrets.testEventCode?.trim();

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: integration.provider, config: configPayload, secrets: secretPayload, isEnabled: enabled }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${integration.provider} settings saved`);
        queryClient.invalidateQueries({ queryKey: ["pixel-health"] });
        setSecrets((s) => ({ ...s, accessToken: "", apiSecret: "" }));
      } else {
        toast.error(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const providers: Record<string, { title: string; desc: string; fields: { key: string; label: string; placeholder: string }[]; secretFields: { key: "accessToken" | "apiSecret" | "testEventCode"; label: string; placeholder: string }[] }> = {
    META: {
      title: "Meta Pixel & Conversions API",
      desc: "Track Meta ads with browser pixel + server-side CAPI using the same event IDs for deduplication.",
      fields: [{ key: "pixelId", label: "Pixel ID", placeholder: "e.g. 1122334455667788" }],
      secretFields: [
        { key: "accessToken", label: "Conversions API Access Token", placeholder: integration.hasAccessToken ? "•••••••• (saved)" : "System user access token" },
        { key: "testEventCode", label: "Test Event Code (optional)", placeholder: "TEST12345" },
      ],
    },
    GOOGLE: {
      title: "Google Analytics & Ads",
      desc: "GA4 browser tag plus Measurement Protocol server events.",
      fields: [
        { key: "ga4MeasurementId", label: "GA4 Measurement ID", placeholder: "G-XXXXXXXXXX" },
        { key: "adsConversionId", label: "Google Ads Conversion ID", placeholder: "AW-123456789" },
        { key: "conversionLabel", label: "Conversion Label", placeholder: "purchase label" },
        { key: "gtmId", label: "Google Tag Manager ID (optional)", placeholder: "GTM-XXXXXX" },
      ],
      secretFields: [
        { key: "apiSecret", label: "Measurement Protocol API Secret", placeholder: integration.hasApiSecret ? "•••••••• (saved)" : "GA4 API secret" },
      ],
    },
    TIKTOK: {
      title: "TikTok Pixel & Events API",
      desc: "Browser pixel plus Events API server forwarding.",
      fields: [{ key: "pixelId", label: "TikTok Pixel ID", placeholder: "e.g. CJKL3ABC456" }],
      secretFields: [
        { key: "accessToken", label: "Events API Access Token", placeholder: integration.hasAccessToken ? "•••••••• (saved)" : "TikTok access token" },
        { key: "testEventCode", label: "Test Event Code (optional)", placeholder: "TEST123" },
      ],
    },
    CUSTOM: {
      title: "Custom Tracking Webhook",
      desc: "Forward all events to your own endpoint (CRM, data warehouse…).",
      fields: [
        { key: "endpoint", label: "Webhook URL", placeholder: "https://your-service.example/track" },
        { key: "headerName", label: "Auth Header Name", placeholder: "X-Api-Key" },
      ],
      secretFields: [{ key: "apiSecret", label: "Auth Header Value", placeholder: integration.hasApiSecret ? "•••••••• (saved)" : "secret value" }],
    },
  };

  const meta = providers[integration.provider];
  if (!meta) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4 w-4 text-brand-600" /> {meta.title}
            </CardTitle>
            <CardDescription className="mt-1 max-w-lg">{meta.desc}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {integration.isEnabled ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">Enabled</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
            )}
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={`Enable ${meta.title}`} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {meta.fields.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`${integration.provider}-${f.key}`}>{f.label}</Label>
              <Input
                id={`${integration.provider}-${f.key}`}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="rounded-xl font-mono text-sm"
              />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-border p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-600" /> Server-side secrets — stored securely, never exposed to the browser
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {meta.secretFields.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`${integration.provider}-${f.key}`}>{f.label}</Label>
                <div className="relative">
                  <Input
                    id={`${integration.provider}-${f.key}`}
                    type={f.key === "testEventCode" || showSecret ? "text" : "password"}
                    value={secrets[f.key] ?? ""}
                    onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="rounded-xl pr-10 font-mono text-sm"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showSecret ? "Hide secret" : "Show secret"}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        {integration.lastError && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
            Last error: {integration.lastError}
          </p>
        )}
        <Button onClick={save} disabled={saving} className="rounded-xl">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save {integration.provider} Settings
        </Button>
      </CardContent>
    </Card>
  );
}

export default function TrackingPixelsPage() {
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
    <div>
      <AdminPageHeader
        title="Tracking & Pixels"
        description="Configure Meta, Google, TikTok and custom tracking integrations"
      />

      {/* Pixel health */}
      <PixelHealthStrip />

      {/* How dedup works */}
      <Card className="mt-4 border-brand-200 bg-brand-50/40 dark:border-brand-100/30 dark:bg-brand-100/10">
        <CardContent className="flex items-start gap-3 p-5 text-sm">
          <Activity className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="font-bold">Browser + Server Deduplication</p>
            <p className="mt-1 text-muted-foreground">
              Important events like <strong>Purchase</strong> are sent from both the browser pixel and the
              server API using the <strong>same event ID</strong> (e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">purchase_SN100123</code>).
              Meta, GA4 and TikTok deduplicate them automatically — and ShopNest analytics count each
              purchase exactly once. Inspect any event in Event Logs to see both copies.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Editors */}
      <div className="mt-4 space-y-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)
        ) : (
          <>
            <IntegrationEditor integration={data.meta} />
            <IntegrationEditor integration={data.google} />
            <IntegrationEditor integration={data.tiktok} />
            <IntegrationEditor integration={data.custom} />
          </>
        )}
      </div>
    </div>
  );
}
