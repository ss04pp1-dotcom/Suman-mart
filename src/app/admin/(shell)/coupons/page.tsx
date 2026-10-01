"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, Ticket, TicketPercent, Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatBDT, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CouponRow {
  id: string; code: string; type: string; value: number; minOrderAmount: number | null;
  maxDiscount: number | null; startsAt: string; expiresAt: string | null;
  usageLimit: number | null; usageCount: number; perCustomerLimit: number | null;
  productId: string | null; categoryId: string | null; customerId: string | null;
  isActive: boolean; createdAt: string;
  product?: { name: string } | null; category?: { name: string } | null; customer?: { name: string } | null;
}

const TYPE_LABELS: Record<string, string> = { PERCENTAGE: "Percentage", FIXED: "Fixed amount", FREE_SHIPPING: "Free shipping" };

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "", type: "PERCENTAGE", value: 10, minOrderAmount: "", maxDiscount: "",
    startsAt: new Date().toISOString().slice(0, 10), expiresAt: "", usageLimit: "",
    perCustomerLimit: "", isActive: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const res = await fetch("/api/admin/coupons");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as CouponRow[];
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({ code: "", type: "PERCENTAGE", value: 10, minOrderAmount: "", maxDiscount: "", startsAt: new Date().toISOString().slice(0, 10), expiresAt: "", usageLimit: "", perCustomerLimit: "", isActive: true });
    setOpen(true);
  };

  const openEdit = (c: CouponRow) => {
    setEditing(c);
    setForm({
      code: c.code, type: c.type, value: c.value,
      minOrderAmount: c.minOrderAmount?.toString() ?? "", maxDiscount: c.maxDiscount?.toString() ?? "",
      startsAt: new Date(c.startsAt).toISOString().slice(0, 10),
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : "",
      usageLimit: c.usageLimit?.toString() ?? "", perCustomerLimit: c.perCustomerLimit?.toString() ?? "",
      isActive: c.isActive,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        code: form.code,
        type: form.type,
        value: form.type === "FREE_SHIPPING" ? 0 : Number(form.value),
        minOrderAmount: form.minOrderAmount ? Number(form.minOrderAmount) : null,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        startsAt: form.startsAt,
        expiresAt: form.expiresAt || null,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : null,
        isActive: form.isActive,
      };
      const res = await fetch("/api/admin/coupons", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, id: editing.id } : payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editing ? "Coupon updated" : "Coupon created");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      } else toast.error(json.error ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: CouponRow) => {
    const res = await fetch("/api/admin/coupons", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, isActive: !c.isActive }),
    });
    if ((await res.json()).success) {
      toast.success(c.isActive ? "Coupon deactivated" : "Coupon activated");
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
    }
  };

  const remove = async (c: CouponRow) => {
    if (!confirm(`Delete coupon ${c.code}?`)) return;
    const res = await fetch(`/api/admin/coupons?id=${c.id}`, { method: "DELETE" });
    if ((await res.json()).success) {
      toast.success("Coupon deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
    }
  };

  const describeScope = (c: CouponRow) => {
    if (c.customer) return `Customer-specific: ${c.customer.name}`;
    if (c.product) return `Product only: ${c.product.name}`;
    if (c.category) return `Category only: ${c.category.name}`;
    return "All products";
  };

  return (
    <div>
      <AdminPageHeader
        title="Coupons"
        description={`${data?.length ?? "…"} discount coupons`}
        actions={<Button className="rounded-xl" onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New Coupon</Button>}
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <AdminEmptyState icon={Ticket} title="No coupons yet" description="Create your first coupon to reward customers and boost sales." action={<Button onClick={openNew} className="rounded-xl"><Plus className="mr-2 h-4 w-4" /> New Coupon</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => {
            const now = new Date();
            const expired = c.expiresAt && new Date(c.expiresAt) < now;
            return (
              <Card key={c.id} className={!c.isActive || expired ? "opacity-75" : ""}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 px-3 py-1 font-mono text-sm font-bold text-brand-700 dark:border-brand-100/50 dark:bg-brand-100/50 dark:text-brand-600">
                          {c.code}
                        </span>
                      </div>
                      <p className="mt-2.5 text-sm font-semibold">
                        {c.type === "PERCENTAGE" ? `${c.value}% off` : c.type === "FIXED" ? `${formatBDT(c.value)} off` : "Free shipping"}
                        {c.type === "PERCENTAGE" && c.maxDiscount ? ` (max ${formatBDT(c.maxDiscount)})` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.minOrderAmount ? `Min order ${formatBDT(c.minOrderAmount)} · ` : ""}
                        {describeScope(c)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge className={c.isActive && !expired ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                        {expired ? "Expired" : c.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <TicketPercent className="h-5 w-5 text-brand-300 dark:text-brand-100/60" />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs">
                    <div><p className="font-bold">{c.usageCount}</p><p className="text-muted-foreground">times used{c.usageLimit ? ` / ${c.usageLimit}` : ""}</p></div>
                    <div><p className="font-bold">{c.expiresAt ? formatDate(c.expiresAt) : "No expiry"}</p><p className="text-muted-foreground">valid until</p></div>
                  </div>

                  <div className="mt-4 flex gap-2 border-t border-border pt-3">
                    <Button size="sm" variant="outline" className="flex-1 rounded-lg" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="outline" className="rounded-lg" onClick={() => toggleActive(c)}>{c.isActive ? "Disable" : "Enable"}</Button>
                    <Button size="sm" variant="outline" className="rounded-lg text-rose-600" onClick={() => remove(c)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.code}` : "New coupon"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-code">Code *</Label>
              <Input id="c-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" className="rounded-xl font-mono uppercase" disabled={Boolean(editing)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage off</SelectItem>
                  <SelectItem value="FIXED">Fixed amount off</SelectItem>
                  <SelectItem value="FREE_SHIPPING">Free shipping</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.type !== "FREE_SHIPPING" && (
              <div>
                <Label htmlFor="c-value">{form.type === "PERCENTAGE" ? "Percent off (%)" : "Amount off (৳)"}</Label>
                <Input id="c-value" type="number" min={1} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))} className="rounded-xl" />
              </div>
            )}
            {form.type === "PERCENTAGE" && (
              <div>
                <Label htmlFor="c-max">Max discount (৳)</Label>
                <Input id="c-max" type="number" min={0} value={form.maxDiscount} onChange={(e) => setForm((f) => ({ ...f, maxDiscount: e.target.value }))} placeholder="No cap" className="rounded-xl" />
              </div>
            )}
            <div>
              <Label htmlFor="c-min">Min order (৳)</Label>
              <Input id="c-min" type="number" min={0} value={form.minOrderAmount} onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))} placeholder="No minimum" className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="c-limit">Total usage limit</Label>
              <Input id="c-limit" type="number" min={0} value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))} placeholder="Unlimited" className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="c-start">Starts</Label>
              <Input id="c-start" type="date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="c-exp">Expires</Label>
              <Input id="c-exp" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="rounded-xl" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3.5 sm:col-span-2">
              <div>
                <p className="text-sm font-semibold">Active</p>
                <p className="text-xs text-muted-foreground">Customers can apply this coupon at checkout</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} aria-label="Coupon active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.code.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editing ? "Save Changes" : "Create Coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
