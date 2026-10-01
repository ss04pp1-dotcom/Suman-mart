"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Banknote, Loader2, MapPin, Package, Phone, Save, Truck, StickyNote, RefreshCw, XCircle, ShieldCheck,
} from "lucide-react";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/status-badge";
import { OrderTimeline } from "@/components/shop/order-timeline";
import { formatBDT, formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, SUPPLIER_ORDER_STATUS_LABELS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface OrderDetail {
  id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: string;
  subtotal: number; discountTotal: number; shippingTotal: number; codCharge: number; total: number; couponCode: string | null;
  shippingAddress: string; customerNote: string | null; internalNotes: string | null;
  courier: string | null; trackingNumber: string | null; estimatedDelivery: string | null;
  createdAt: string; customerName: string; customerPhone: string; customerEmail: string | null;
  allowedStatuses: string[];
  paymentMerchantNumber?: string;
  customer: { id: string; name: string; email: string; phone: string; createdAt: string } | null;
  items: { id: string; name: string; sku: string; imageUrl: string | null; unitPrice: number; quantity: number; total: number; options: string | null; product: { slug: string } | null }[];
  statusHistory: { id: string; status: string; note: string | null; createdBy: string; createdAt: string }[];
  payments: { id: string; method: string; status: string; amount: number; transactionId: string | null; createdAt: string }[];
  supplierOrders: { id: string; status: string; externalOrderId: string | null; trackingNumber: string | null; courier: string | null; total: number; supplier: { id: string; name: string } }[];
}

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ["admin-order", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/orders/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as OrderDetail;
    },
  });

  const [status, setStatus] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [courier, setCourier] = useState<string>("");
  const [tracking, setTracking] = useState<string>("");
  const [note, setNote] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [smsVerified, setSmsVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Initialize form when order loads
  const [initialized, setInitialized] = useState(false);
  if (order && !initialized) {
    setStatus(order.status);
    setPaymentStatus(order.paymentStatus);
    setCourier(order.courier ?? "");
    setTracking(order.trackingNumber ?? "");
    setInternalNotes(order.internalNotes ?? "");
    setSmsVerified(false);
    setInitialized(true);
  }

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: status !== order?.status ? status : undefined,
          paymentStatus: paymentStatus !== order?.paymentStatus ? paymentStatus : undefined,
          courier: courier !== (order?.courier ?? "") ? courier : undefined,
          trackingNumber: tracking !== (order?.trackingNumber ?? "") ? tracking : undefined,
          internalNotes: internalNotes !== (order?.internalNotes ?? "") ? internalNotes : undefined,
          note: note || undefined,
          // Round-4 audit: required (server-enforced) to mark a manual payment PAID.
          smsVerified: smsVerified || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Order updated");
        setNote("");
        queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        setInitialized(false); // re-sync form
      } else {
        toast.error(data.error ?? "Update failed");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const supplierAction = async (supplierOrderId: string, action: "refresh" | "cancel") => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/suppliers/orders/${supplierOrderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(action === "refresh" ? "Supplier status refreshed" : data.data.message ?? "Cancellation requested");
        queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      } else {
        toast.error(data.error ?? "Action failed");
      }
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!order) {
    return <p className="p-8 text-center text-muted-foreground">Order not found.</p>;
  }

  const address = JSON.parse(order.shippingAddress) as { fullName: string; phone: string; line1: string; line2?: string; city: string; area?: string; postalCode?: string };

  // Round-4 audit: marking a manual payment PAID requires an explicit SMS-match
  // confirmation (enforced server-side via smsVerified).
  const pendingTrxId = order.payments.find((p) => p.status === "PENDING" && p.transactionId && !p.transactionId.includes("-RELEASED-"))?.transactionId ?? null;
  const markingManualPaid =
    order.paymentStatus !== "PAID" && paymentStatus === "PAID" && ["BKASH", "NAGAD"].includes(order.paymentMethod);
  const smsBlockSave = markingManualPaid && !smsVerified;

  // Round-5 audit: cancelling/returning an order that still holds an UNVERIFIED
  // (Pending) manual payment releases its TrxID for reuse on a NEW order.
  // That is correct when no money ever arrived — but WRONG when the money DID
  // arrive and the operator refunded it outside the system (bKash/Nagad app):
  // the buyer could then fund a second order with the same real transfer. The
  // safe sequence in that case is ONE save with Payment status = Paid + the
  // SMS-match tick + the cancel — the server flips the payment to SUCCESS
  // before the release step, so the verified TrxID stays locked forever.
  const pendingManualClaim =
    pendingTrxId !== null && order.paymentStatus !== "PAID" && ["BKASH", "NAGAD"].includes(order.paymentMethod);
  const cancellingReleasesClaim =
    pendingManualClaim && status !== order.status && ["CANCELLED", "RETURNED"].includes(status) && paymentStatus !== "PAID";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-xl">
            <Link href="/admin/orders" aria-label="Back to orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-2xl font-extrabold">{order.orderNumber}</h2>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">Placed {formatDateTime(order.createdAt)}</p>
          </div>
        </div>
        <Button onClick={save} disabled={saving || smsBlockSave} className="rounded-xl">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {smsBlockSave && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Confirm the SMS match in the Payment card before saving — the server rejects marking a bKash/Nagad payment as Paid without it.
        </p>
      )}

      {cancellingReleasesClaim && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-semibold">
            Cancelling now will release TrxID <span className="font-mono">{pendingTrxId}</span> for reuse on a new order.
          </p>
          <p className="mt-1">
            That is right if no money ever arrived. But if the payment DID arrive and you refunded it outside the
            system (bKash/Nagad app), set Payment status to <strong>Paid</strong> and tick the SMS-match confirmation
            in the <strong>same save</strong> — the verified TrxID then stays locked even after cancellation.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Items */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Items ({order.items.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-border/60 p-4 last:border-0">
                                    {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
                  <div className="min-w-0 flex-1">
                    {item.product?.slug ? (
                      <Link href={`/products/${item.product.slug}`} className="text-sm font-semibold hover:text-brand-600" target="_blank">
                        {item.name}
                      </Link>
                    ) : (
                      <p className="text-sm font-semibold">{item.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      SKU {item.sku} · Qty {item.quantity} · {formatBDT(item.unitPrice)} each
                      {item.options ? ` · ${Object.values(JSON.parse(item.options)).join(", ")}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-bold">{formatBDT(item.total)}</p>
                </div>
              ))}
              <div className="space-y-1.5 border-t border-border p-4 text-sm">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatBDT(order.subtotal)}</span></div>
                {order.discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>Discount {order.couponCode && `(${order.couponCode})`}</span><span>−{formatBDT(order.discountTotal)}</span></div>
                )}
                <div className="flex justify-between text-muted-foreground"><span>Shipping</span><span>{order.shippingTotal === 0 ? "FREE" : formatBDT(order.shippingTotal)}</span></div>
                {order.codCharge > 0 && (
                  <div className="flex justify-between text-muted-foreground"><span>COD charge</span><span>{formatBDT(order.codCharge)}</span></div>
                )}
                <Separator className="my-2" />
                <div className="flex justify-between text-base font-extrabold"><span>Total</span><span>{formatBDT(order.total)}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Update panel */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Update Order</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="status">Fulfillment status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="status" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Lifecycle-validated transitions from the server (current status always selectable as no-op) */}
                    {[order.status, ...(order.allowedStatuses ?? [])]
                      .filter((s, i, arr) => arr.indexOf(s) === i)
                      .map((s) => (
                        <SelectItem key={s} value={s}>
                          {ORDER_STATUS_LABELS[s] ?? s}
                          {s === order.status ? " (current)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {(order.allowedStatuses?.length ?? 0) === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Terminal status — no further changes allowed.</p>
                )}
              </div>
              <div>
                <Label htmlFor="paymentStatus">Payment status</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger id="paymentStatus" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="courier">Courier</Label>
                <Input id="courier" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. Steadfast Courier" className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="tracking">Tracking number</Label>
                <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. SF123456789" className="rounded-xl font-mono" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="note">Status note (shown to customer)</Label>
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the status change" className="rounded-xl" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="internalNotes" className="flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" /> Internal notes</Label>
                <Textarea id="internalNotes" rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Visible to admins only…" className="rounded-xl" />
              </div>
            </CardContent>
          </Card>

          {/* Supplier orders */}
          {order.supplierOrders.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Supplier Orders</CardTitle>
                <CardDescription>Dropship fulfillment for this order</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.supplierOrders.map((so) => (
                  <div key={so.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{so.supplier.name}</p>
                      <Badge variant="outline" className="font-mono text-[11px]">{so.externalOrderId ?? "—"}</Badge>
                      <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300">
                        {SUPPLIER_ORDER_STATUS_LABELS[so.status] ?? so.status}
                      </Badge>
                      <span className="ml-auto text-sm font-semibold text-muted-foreground">{formatBDT(so.total)}</span>
                    </div>
                    {(so.trackingNumber || so.courier) && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" /> {so.courier} · <span className="font-mono">{so.trackingNumber}</span>
                      </p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-lg" onClick={() => supplierAction(so.id, "refresh")} disabled={syncing}>
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Refresh status
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-lg text-rose-600 hover:text-rose-600" onClick={() => supplierAction(so.id, "cancel")} disabled={syncing}>
                        <XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Status history */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Status History</CardTitle></CardHeader>
            <CardContent>
              <OrderTimeline status={order.status} history={order.statusHistory.map((h) => ({ status: h.status, note: `${h.note ?? ""}${h.createdBy !== "system" ? ` · by ${h.createdBy}` : ""}`, createdAt: h.createdAt }))} compact />
            </CardContent>
          </Card>
        </div>

        {/* Side column */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-brand-600" /> Customer</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-semibold">{order.customerName}</p>
                {order.customer ? (
                  <Link href={`/admin/customers/${order.customer.id}`} className="text-xs text-brand-700 hover:underline dark:text-brand-600">
                    View customer profile →
                  </Link>
                ) : (
                  <Badge variant="outline" className="mt-1">Guest checkout</Badge>
                )}
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {order.customerPhone}</p>
                <p className="text-muted-foreground">{order.customerEmail ?? "—"}</p>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery address</p>
                <p className="mt-1.5">{address.fullName} · {address.phone}</p>
                <p className="text-muted-foreground">{address.line1}{address.line2 ? `, ${address.line2}` : ""}</p>
                <p className="text-muted-foreground">{address.area ? `${address.area}, ` : ""}{address.city}{address.postalCode ? ` - ${address.postalCode}` : ""}</p>
              </div>
              {order.customerNote && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer note</p>
                    <p className="mt-1 text-muted-foreground">{order.customerNote}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4 text-brand-600" /> Payment</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="font-medium">{PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
              {order.paymentStatus === "UNPAID" && ["BKASH", "NAGAD"].includes(order.paymentMethod) && (
                <div className="rounded-xl border-2 border-amber-300/70 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
                    <ShieldCheck className="h-4 w-4" /> Manual verification required — match against your merchant SMS
                  </p>
                  {/* Round-4 audit: the expected amount and TrxID are the two facts staff
                      must match in the merchant statement — show them LARGE, side by side. */}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/70 p-2.5 text-center dark:bg-black/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/70">Expected amount</p>
                      <p className="text-xl font-extrabold text-amber-900 dark:text-amber-200">{formatBDT(order.total)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-2.5 text-center dark:bg-black/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/70">Customer TrxID</p>
                      <p className="text-xl font-extrabold font-mono text-amber-900 dark:text-amber-200">{pendingTrxId ?? "—"}</p>
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs text-amber-800/90 dark:text-amber-300/80">
                    A TrxID is only the buyer&apos;s claim — the system cannot match amounts or sender numbers. Verify that{" "}
                    <span className="font-bold">{formatBDT(order.total)}</span> arrived in your{" "}
                    {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod} account
                    {order.paymentMerchantNumber ? (<> at <span className="font-mono font-bold">{order.paymentMerchantNumber}</span></>) : null}
                    {pendingTrxId ? (<> and that SMS entry <span className="font-mono font-bold">{pendingTrxId}</span> exists with this exact amount</>) : null}.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300 bg-white/60 p-2.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-black/20 dark:text-amber-200">
                    <input
                      type="checkbox"
                      checked={smsVerified}
                      onChange={(e) => setSmsVerified(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
                    />
                    <span>I matched the amount and TrxID against the merchant SMS/statement — required before this payment can be marked Paid.</span>
                  </label>
                </div>
              )}
              {order.payments.map((p) => (
                <div key={p.id} className="rounded-xl bg-muted/50 p-3 text-xs">
                  <p className="font-semibold">{p.method} · {p.status}</p>
                  <p className="text-muted-foreground">{formatBDT(p.amount)} · {formatDateTime(p.createdAt)}</p>
                  {p.transactionId && (
                    <p className="mt-1">
                      <span className="text-muted-foreground">TrxID: </span>
                      <span className="font-mono font-semibold">{p.transactionId}</span>
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4 text-brand-600" /> Tracking</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Courier</span><span className="font-medium">{order.courier ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tracking</span><span className="font-mono font-medium">{order.trackingNumber ?? "—"}</span></div>
              {order.estimatedDelivery && (
                <div className="flex justify-between"><span className="text-muted-foreground">Est. delivery</span><span className="font-medium">{new Date(order.estimatedDelivery).toLocaleDateString("en-GB")}</span></div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
