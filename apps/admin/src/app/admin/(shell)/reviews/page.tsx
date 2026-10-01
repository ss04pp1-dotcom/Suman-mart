"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Check, ChevronLeft, ChevronRight, EyeOff, MessageSquareQuote, Reply, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatDate, REVIEW_STATUS_LABELS } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ReviewRow {
  id: string; authorName: string; rating: number; title: string | null; comment: string;
  status: string; isFeatured: boolean; verifiedPurchase: boolean; adminReply: string | null; createdAt: string;
  product: { name: string; slug: string } | null;
  customer: { name: string; email: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400",
  APPROVED: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400",
  REJECTED: "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400",
  HIDDEN: "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400",
};

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ status: "", q: "", page: 1 });
  const [replyTo, setReplyTo] = useState<ReviewRow | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reviews", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.q) params.set("q", filters.q);
      params.set("page", String(filters.page));
      params.set("limit", "12");
      const res = await fetch(`/api/admin/reviews?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { items: ReviewRow[]; total: number; page: number; totalPages: number; counts: Record<string, number> };
    },
  });

  const moderate = async (id: string, payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/reviews", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    const json = await res.json();
    if (json.success) {
      toast.success("Review updated");
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    } else toast.error(json.error);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this review permanently?")) return;
    const res = await fetch(`/api/admin/reviews?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      toast.success("Review deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    } else toast.error(json.error);
  };

  const saveReply = async () => {
    if (!replyTo || !replyText.trim()) return;
    await moderate(replyTo.id, { adminReply: replyText.trim() });
    setReplyTo(null);
    setReplyText("");
  };

  const counts = data?.counts ?? {};

  return (
    <div>
      <AdminPageHeader title="Reviews" description={`${data?.total ?? "…"} product reviews`} />

      <Tabs value={filters.status} onValueChange={(v) => setFilters({ status: v, q: filters.q, page: 1 })} className="mb-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 no-scrollbar sm:w-fit">
          <TabsTrigger value="" className="rounded-xl px-4 py-2 text-sm">All ({Object.values(counts).reduce((a, b) => a + b, 0)})</TabsTrigger>
          {Object.entries(REVIEW_STATUS_LABELS).map(([k, v]) => (
            <TabsTrigger key={k} value={k} className="rounded-xl px-4 py-2 text-sm">{v} ({counts[k] ?? 0})</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} placeholder="Search reviews by author, product or content…" className="h-10 rounded-xl pl-9" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState icon={MessageSquareQuote} title="No reviews found" description="Reviews appear here as customers submit them." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.items.map((r) => (
              <Card key={r.id} className={cn(r.status === "PENDING" && "border-amber-300 dark:border-amber-800")}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="flex items-center gap-1.5 text-sm font-bold">
                          {r.authorName}
                          {r.verifiedPurchase && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                              <BadgeCheck className="h-3 w-3" /> Verified
                            </span>
                          )}
                        </p>
                        {r.customer && <Badge variant="outline" className="text-[10px]">Verified account</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        on <a href={`/products/${r.product?.slug}`} target="_blank" className="font-semibold text-brand-700 hover:underline dark:text-brand-600">{r.product?.name}</a> · {formatDate(r.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={cn("h-3.5 w-3.5", i < r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                      ))}
                    </div>
                  </div>

                  {r.title && <p className="mt-3 text-sm font-semibold">{r.title}</p>}
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>

                  {r.adminReply && (
                    <div className="mt-3 rounded-xl bg-brand-50 p-3 text-xs dark:bg-brand-100">
                      <p className="font-semibold text-brand-700 dark:text-brand-600">ShopNest reply</p>
                      <p className="mt-0.5 text-muted-foreground">{r.adminReply}</p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Badge className={STATUS_STYLES[r.status]}>{REVIEW_STATUS_LABELS[r.status]}</Badge>
                    {r.isFeatured && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400">★ Featured</Badge>}
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {r.status !== "APPROVED" && (
                        <Button size="sm" variant="outline" className="h-8 rounded-lg text-emerald-600" onClick={() => moderate(r.id, { status: "APPROVED" })}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Approve
                        </Button>
                      )}
                      {r.status !== "REJECTED" && (
                        <Button size="sm" variant="outline" className="h-8 rounded-lg text-rose-600" onClick={() => moderate(r.id, { status: "REJECTED" })}>
                          <EyeOff className="mr-1 h-3.5 w-3.5" /> Reject
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => moderate(r.id, { isFeatured: !r.isFeatured })}>
                        <Star className={cn("mr-1 h-3.5 w-3.5", r.isFeatured && "fill-amber-400 text-amber-400")} /> {r.isFeatured ? "Unfeature" : "Feature"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setReplyTo(r)}>
                        <Reply className="mr-1 h-3.5 w-3.5" /> Reply
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 rounded-lg text-rose-600" onClick={() => remove(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page >= data.totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={Boolean(replyTo)} onOpenChange={(open) => !open && setReplyTo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Reply to {replyTo?.authorName}</DialogTitle></DialogHeader>
          <Textarea rows={4} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Your public reply shown under the review…" className="rounded-xl" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyTo(null)}>Cancel</Button>
            <Button onClick={saveReply} disabled={!replyText.trim()}>Post Reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
