import {
  ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", ORDER_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-transparent")}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", PAYMENT_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-transparent")}>
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
