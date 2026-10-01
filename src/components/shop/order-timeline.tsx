import { Check, Clock, PackageCheck, XCircle } from "lucide-react";
import { ORDER_TIMELINE, ORDER_STATUS_LABELS, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HistoryEntry {
  status: string;
  note: string | null;
  createdAt: string | Date;
}

export function OrderTimeline({
  status,
  history,
  compact = false,
}: {
  status: string;
  history: HistoryEntry[];
  compact?: boolean;
}) {
  // Cancelled / returned orders show a short special timeline
  if (status === "CANCELLED" || status === "RETURNED") {
    return (
      <div className="space-y-4">
        {history.map((h, i) => (
          <div key={i} className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                h.status === status ? "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400" : "bg-muted text-muted-foreground"
              )}
            >
              {h.status === status ? <XCircle className="h-4 w-4" /> : <Check className="h-3.5 w-3.5" />}
            </div>
            <div>
              <p className={cn("text-sm font-semibold", h.status === status && "text-rose-600 dark:text-rose-400")}>
                {ORDER_STATUS_LABELS[h.status] ?? h.status}
              </p>
              {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
              <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const currentIndex = ORDER_TIMELINE.indexOf(status as (typeof ORDER_TIMELINE)[number]);
  const historyByStatus = new Map(history.map((h) => [h.status, h]));

  return (
    <ol className={cn("relative", compact ? "space-y-4" : "space-y-5")}>
      {ORDER_TIMELINE.map((step, i) => {
        const done = i <= currentIndex;
        const isCurrent = i === currentIndex;
        const entry = historyByStatus.get(step);
        return (
          <li key={step} className="relative flex items-start gap-3">
            {/* Connector */}
            {i < ORDER_TIMELINE.length - 1 && (
              <span
                className={cn(
                  "absolute left-[13px] top-7 h-full w-0.5",
                  i < currentIndex ? "bg-brand-600" : "bg-border"
                )}
                aria-hidden
              />
            )}
            <div
              className={cn(
                "z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                done
                  ? isCurrent
                    ? "bg-brand-600 text-white"
                    : "bg-brand-100 text-brand-700 dark:bg-brand-100 dark:text-brand-700"
                  : "border-2 border-border bg-card text-muted-foreground"
              )}
            >
              {done && !isCurrent ? (
                <Check className="h-3.5 w-3.5" />
              ) : isCurrent ? (
                <Clock className="h-3.5 w-3.5 animate-pulse-dot" />
              ) : (
                <span className="text-[10px] font-bold">{i + 1}</span>
              )}
            </div>
            <div className="pb-1">
              <p className={cn("text-sm font-semibold", !done && "text-muted-foreground", isCurrent && "text-brand-700 dark:text-brand-600")}>
                {ORDER_STATUS_LABELS[step]}
                {isCurrent && (
                  <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700 dark:bg-brand-100 dark:text-brand-600">
                    Current
                  </span>
                )}
              </p>
              {entry ? (
                <>
                  {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                  <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
                </>
              ) : (
                done && <p className="text-xs text-muted-foreground">Completed</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const cancelled = status === "CANCELLED" || status === "RETURNED";
  const delivered = status === "DELIVERED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        cancelled
          ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
          : delivered
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      )}
    >
      {delivered && <PackageCheck className="h-3.5 w-3.5" />}
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}
