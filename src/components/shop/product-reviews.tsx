"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RatingStars } from "./product-card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

export interface ReviewData {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  comment: string;
  isFeatured: boolean;
  verifiedPurchase: boolean;
  createdAt: string;
  adminReply: string | null;
}

export function ProductReviews({
  productId,
  productName,
  reviews,
  rating,
  reviewCount,
}: {
  productId: string;
  productName: string;
  reviews: ReviewData[];
  rating: number;
  reviewCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ authorName: "", rating: 5, title: "", comment: "" });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          rating: form.rating,
          title: form.title || null,
          comment: form.comment,
          authorName: form.authorName || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Review submitted", { description: "Thank you! Your review will appear after moderation." });
        setOpen(false);
        setForm({ authorName: "", rating: 5, title: "", comment: "" });
      } else {
        toast.error(data.error ?? "Could not submit review");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card px-8 py-5">
          <p className="text-4xl font-extrabold">{rating.toFixed(1)}</p>
          <RatingStars rating={rating} />
          <p className="text-xs text-muted-foreground">{reviewCount} reviews</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-right font-medium">{d.star}</span>
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${reviews.length ? (d.count / reviews.length) * 100 : 0}%` }}
                />
              </div>
              <span className="w-6 text-muted-foreground">{d.count}</span>
            </div>
          ))}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full">Write a Review</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Review {productName}</DialogTitle>
              <DialogDescription>Share your experience with other shoppers.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="review-name">Your name</Label>
                <Input
                  id="review-name"
                  value={form.authorName}
                  onChange={(e) => setForm((f) => ({ ...f, authorName: e.target.value }))}
                  placeholder="e.g. Ayesha S."
                />
              </div>
              <div>
                <Label>Your rating</Label>
                <div className="flex gap-1 pt-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, rating: s }))}
                      aria-label={`Rate ${s} stars`}
                    >
                      <Star
                        className={cn(
                          "h-7 w-7 transition-colors",
                          s <= form.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="review-title">Title (optional)</Label>
                <Input
                  id="review-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Sum it up in a few words"
                />
              </div>
              <div>
                <Label htmlFor="review-comment">Your review</Label>
                <Textarea
                  id="review-comment"
                  required
                  minLength={10}
                  value={form.comment}
                  onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                  placeholder="What did you like or dislike?"
                  rows={4}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit Review"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {reviews.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No reviews yet — be the first to share your thoughts.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {reviews.map((r) => (
            <article key={r.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {r.authorName}
                    {r.verifiedPurchase && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <BadgeCheck className="h-3 w-3" /> Verified purchase
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                </div>
                <RatingStars rating={r.rating} />
              </div>
              {r.title && <p className="mt-2.5 text-sm font-semibold">{r.title}</p>}
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>
              {r.adminReply && (
                <div className="mt-3 rounded-xl bg-brand-50 p-3 text-xs dark:bg-brand-100">
                  <p className="font-semibold text-brand-700 dark:text-brand-600">Response from ShopNest</p>
                  <p className="mt-0.5 text-muted-foreground">{r.adminReply}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
