"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ChevronLeft, ChevronRight, RotateCcw, Search, ScrollText,
  CheckCircle2, XCircle, MinusCircle, Monitor, Server, ShieldCheck,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { formatBDT, formatDateTime, EVENT_LABELS, TRAFFIC_SOURCE_LABELS, DEVICE_LABELS } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface EventRow {
  id: string; eventId: string; name: string; url: string | null; productId: string | null;
  productName: string | null; searchQuery: string | null; value: number | null; quantity: number | null;
  source: string; device: string | null; browser: string | null; trafficSource: string | null;
  campaign: string | null; country: string | null; createdAt: string;
  metaStatus: string | null; ga4Status: string | null; tiktokStatus: string | null;
}

interface EventDetailData {
  event: EventRow & { currency: string };
  session: {
    sessionKey: string; device: string; browser: string; os: string; country: string; region: string;
    source: string; medium: string; campaign: string | null; referrer: string | null;
    landingPath: string | null; firstSeenAt: string; isReturning: boolean; pageViewCount: number;
  };
  copies: { id: string; source: string; metaStatus: string | null; ga4Status: string | null; tiktokStatus: string | null; deliveryError: string | null; createdAt: string }[];
  deduplication: { browserReceived: boolean; serverReceived: boolean; applied: boolean; copyCount: number };
}

function DeliveryBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline" className="text-[10px] text-muted-foreground">—</Badge>;
  const label = status === "SUCCESS" ? "Success" : status === "ERROR" ? "Error" : status === "SKIPPED" ? "Skipped" : status;
  const cls =
    status === "SUCCESS" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400"
    : status === "ERROR" ? "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400"
    : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400";
  return <Badge className={`text-[10px] ${cls}`}>{label}</Badge>;
}

export default function EventLogsPage() {
  const [filters, setFilters] = useState<{ range: string; from?: string; to?: string; event: string; source: string; device: string; q: string; page: number }>({ range: "7d", event: "", source: "", device: "", q: "", page: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["event-logs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.range !== "custom") params.set("range", filters.range);
      else {
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
      }
      if (filters.event) params.set("event", filters.event);
      if (filters.source) params.set("source", filters.source);
      if (filters.device) params.set("device", filters.device);
      if (filters.q) params.set("q", filters.q);
      params.set("page", String(filters.page));
      params.set("limit", "20");
      const res = await fetch(`/api/admin/analytics/events?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { items: EventRow[]; total: number; page: number; totalPages: number };
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["event-detail", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/events/${selectedId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as EventDetailData;
    },
    enabled: Boolean(selectedId),
  });

  const setFilter = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));

  return (
    <div>
      <AdminPageHeader
        title="Event Logs"
        description="Every tracked event with full delivery diagnostics"
        actions={<DateRangeFilter range={filters.range} from={filters.from} to={filters.to} onChange={(n) => setFilters((prev) => ({ ...prev, ...n }))} />}
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.q} onChange={(e) => setFilter("q", e.target.value)} placeholder="Search product, query or event ID…" className="h-10 rounded-xl pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={filters.event || "all_ev"} onValueChange={(v) => setFilter("event", v === "all_ev" ? "" : v)}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl" aria-label="Event type"><SelectValue placeholder="Event" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_ev">All events</SelectItem>
                {Object.entries(EVENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.source || "all_src"} onValueChange={(v) => setFilter("source", v === "all_src" ? "" : v)}>
              <SelectTrigger className="h-10 w-[130px] rounded-xl" aria-label="Traffic source"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_src">All sources</SelectItem>
                {Object.entries(TRAFFIC_SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.device || "all_dev"} onValueChange={(v) => setFilter("device", v === "all_dev" ? "" : v)}>
              <SelectTrigger className="h-10 w-[130px] rounded-xl" aria-label="Device"><SelectValue placeholder="Device" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_dev">All devices</SelectItem>
                {Object.entries(DEVICE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={() => setFilters({ range: "7d", event: "", source: "", device: "", q: "", page: 1 })} aria-label="Reset">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="space-y-2 p-4">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </CardContent></Card>
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState icon={ScrollText} title="No events found" description="Try widening the date range or clearing filters." />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{data.total.toLocaleString()} events · page {data.page} of {data.totalPages}</p>
          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Product / Query</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Meta / GA4</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((e) => (
                      <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelectedId(e.id)}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-brand-50 text-brand-700 hover:bg-brand-50 dark:bg-brand-100 dark:text-brand-600">
                              {EVENT_LABELS[e.name] ?? e.name}
                            </Badge>
                            {e.source === "SERVER" && <Badge variant="outline" className="text-[10px]">Srv</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px]"><p className="truncate text-sm">{e.productName ?? e.searchQuery ?? "—"}</p></TableCell>
                        <TableCell className="text-sm">{e.value ? formatBDT(e.value) : "—"}</TableCell>
                        <TableCell className="text-xs">{TRAFFIC_SOURCE_LABELS[e.trafficSource ?? ""] ?? e.trafficSource ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.device?.toLowerCase() ?? "—"} · {e.browser ?? ""}</TableCell>
                        <TableCell className="max-w-[140px]"><p className="truncate font-mono text-xs">{e.campaign ?? "—"}</p></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <DeliveryBadge status={e.metaStatus} />
                            <DeliveryBadge status={e.ga4Status} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile */}
              <div className="divide-y divide-border md:hidden">
                {data.items.map((e) => (
                  <button key={e.id} className="block w-full p-4 text-left" onClick={() => setSelectedId(e.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge className="bg-brand-50 text-brand-700 hover:bg-brand-50 dark:bg-brand-100 dark:text-brand-600">{EVENT_LABELS[e.name] ?? e.name}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm">{e.productName ?? e.searchQuery ?? "—"}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {e.value ? <span className="font-semibold text-foreground">{formatBDT(e.value)}</span> : null}
                      <span>{e.trafficSource}</span>
                      <span>· {e.device?.toLowerCase()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} aria-label="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page >= data.totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} aria-label="Next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Event debugger dialog */}
      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detailLoading || !detail ? (
            <div className="space-y-3">
              {/* Radix requires a DialogTitle in every DialogContent state —
                  the skeleton branch previously rendered none, logging an
                  accessibility error while the detail query was in flight. */}
              <DialogHeader>
                <DialogTitle className="sr-only">Loading event details</DialogTitle>
              </DialogHeader>
              <Skeleton className="h-8 w-40" />
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-brand-600" />
                  Event Inspector — {EVENT_LABELS[detail.event.name] ?? detail.event.name}
                </DialogTitle>
                <DialogDescription>Full journey and delivery diagnostics for this event</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Core fields */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Event ID", detail.event.eventId],
                    ["Value", detail.event.value ? `${formatBDT(detail.event.value)} ${detail.event.currency}` : "—"],
                    ["Product", detail.event.productName ?? "—"],
                    ["Search query", detail.event.searchQuery ?? "—"],
                    ["Page URL", detail.event.url ?? "—"],
                    ["Occurred", formatDateTime(detail.event.createdAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted/50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-0.5 break-all font-mono text-xs font-semibold">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Dedup status */}
                <div className="rounded-xl border-2 border-brand-200 bg-brand-50/50 p-4 dark:border-brand-100/30 dark:bg-brand-100/10">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <ShieldCheck className="h-4 w-4 text-brand-600" /> Deduplication
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                    <div className={`rounded-lg p-2.5 ${detail.deduplication.browserReceived ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      <Monitor className="mx-auto mb-1 h-4 w-4" /> Browser: {detail.deduplication.browserReceived ? "Received" : "—"}
                    </div>
                    <div className={`rounded-lg p-2.5 ${detail.deduplication.serverReceived ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      <Server className="mx-auto mb-1 h-4 w-4" /> Server: {detail.deduplication.serverReceived ? "Received" : "—"}
                    </div>
                    <div className={`rounded-lg p-2.5 ${detail.deduplication.applied ? "bg-brand-600 text-white" : "bg-muted text-muted-foreground"}`}>
                      <CheckCircle2 className="mx-auto mb-1 h-4 w-4" /> Dedup: {detail.deduplication.applied ? "Applied" : "N/A"}
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs text-muted-foreground">
                    {detail.deduplication.applied
                      ? `Browser and server copies share the event ID — counted once in analytics (${detail.deduplication.copyCount} copies stored).`
                      : "Only one copy of this event exists — no deduplication needed."}
                  </p>
                </div>

                {/* Provider delivery */}
                <div>
                  <p className="mb-2 text-sm font-bold">Provider Delivery</p>
                  <div className="space-y-2">
                    {[
                      ["Meta Conversions API", detail.copies[0]?.metaStatus ?? detail.event.metaStatus],
                      ["GA4 Measurement Protocol", detail.copies[0]?.ga4Status ?? detail.event.ga4Status],
                      ["TikTok Events API", detail.copies[0]?.tiktokStatus ?? detail.event.tiktokStatus],
                    ].map(([label, status]) => (
                      <div key={label} className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5 text-sm">
                        <span className="font-medium">{label}</span>
                        <div className="flex items-center gap-2">
                          <DeliveryBadge status={status as string | null} />
                          {status === "ERROR" && <XCircle className="h-4 w-4 text-rose-500" />}
                          {status === "SUCCESS" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                          {(!status || status === "SKIPPED") && <MinusCircle className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    ))}
                  </div>
                  {detail.copies.some((c) => c.deliveryError) && (
                    <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
                      Last error: {detail.copies.find((c) => c.deliveryError)?.deliveryError}
                    </p>
                  )}
                </div>

                {/* Session context */}
                <div>
                  <p className="mb-2 text-sm font-bold">Session Context</p>
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-4 text-xs sm:grid-cols-3">
                    {[
                      ["Device", `${DEVICE_LABELS[detail.session.device] ?? detail.session.device} · ${detail.session.os}`],
                      ["Browser", detail.session.browser],
                      ["Location", `${detail.session.country}${detail.session.region ? ` / ${detail.session.region}` : ""}`],
                      ["Source", `${TRAFFIC_SOURCE_LABELS[detail.session.source] ?? detail.session.source} (${detail.session.medium})`],
                      ["Campaign", detail.session.campaign ?? "—"],
                      ["Visitor type", detail.session.isReturning ? "Returning" : "New"],
                      ["Landing page", detail.session.landingPath ?? "—"],
                      ["Referrer", detail.session.referrer ?? "direct"],
                      ["Page views", String(detail.session.pageViewCount)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
                        <p className="mt-0.5 font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
