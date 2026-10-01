"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Loader2, Package, Plus, RefreshCw, Save, Truck, Power, Trash2, Pencil } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SupplierRow {
  id: string; name: string; code: string; email: string | null; phone: string | null;
  adapter: string; baseUrl: string | null; autoSyncPrice: boolean; autoSyncStock: boolean;
  isActive: boolean; notes: string | null; lastSyncAt: string | null; hasApiKey: boolean;
  productCount: number; orderCount: number;
  lastSync: { status: string; type: string; createdAt: string; message: string | null } | null;
}

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", code: "", email: "", phone: "", adapter: "demo-wholesale-v1", baseUrl: "",
    apiKey: "", apiSecret: "", autoSyncPrice: true, autoSyncStock: true, markupPercent: 25,
    isActive: true, notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/suppliers");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { suppliers: SupplierRow[]; adapters: { key: string; label: string; description: string }[] };
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", code: "", email: "", phone: "", adapter: "demo-wholesale-v1", baseUrl: "", apiKey: "", apiSecret: "", autoSyncPrice: true, autoSyncStock: true, markupPercent: 25, isActive: true, notes: "" });
    setOpen(true);
  };

  const openEdit = (s: SupplierRow) => {
    setEditing(s);
    setForm({
      name: s.name, code: s.code, email: s.email ?? "", phone: s.phone ?? "", adapter: s.adapter,
      baseUrl: s.baseUrl ?? "", apiKey: "", apiSecret: "", autoSyncPrice: s.autoSyncPrice,
      autoSyncStock: s.autoSyncStock, markupPercent: 25, isActive: s.isActive, notes: s.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return toast.error("Name and code are required");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/suppliers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...form, id: editing.id } : form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editing ? "Supplier updated" : "Supplier created");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
      } else toast.error(json.error ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const sync = async (supplierId: string, type: "PRODUCTS" | "PRICES" | "STOCK") => {
    setSyncing(`${supplierId}-${type}`);
    try {
      const res = await fetch(`/api/admin/suppliers/${supplierId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (json.success) {
        const o = json.data;
        toast[o.status === "FAILED" ? "error" : "success"](o.message, {
          description: `${o.itemsProcessed} processed · ${o.itemsCreated} new · ${o.itemsUpdated} updated · ${(o.durationMs / 1000).toFixed(1)}s`,
        });
        queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
      } else toast.error(json.error);
    } finally {
      setSyncing(null);
    }
  };

  const toggleActive = async (s: SupplierRow) => {
    const res = await fetch("/api/admin/suppliers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isActive: !s.isActive }),
    });
    if ((await res.json()).success) {
      toast.success(s.isActive ? "Supplier disabled" : "Supplier enabled");
      queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
    }
  };

  return (
    <div>
      <AdminPageHeader
        title="Suppliers"
        description="Dropshipping partners, product sync and automation"
        actions={<Button className="rounded-xl" onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Add Supplier</Button>}
      />

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
        </div>
      ) : !data || data.suppliers.length === 0 ? (
        <AdminEmptyState icon={Truck} title="No suppliers yet" description="Connect your first dropshipping partner to start importing products." action={<Button onClick={openNew} className="rounded-xl"><Plus className="mr-2 h-4 w-4" /> Add Supplier</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.suppliers.map((s) => (
            <Card key={s.id} className={s.isActive ? "" : "opacity-75"}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/suppliers/${s.id}`} className="font-bold hover:text-brand-600">{s.name}</Link>
                        <Badge variant="outline" className="font-mono text-[10px]">{s.code}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.email ?? "no email"} · {s.hasApiKey ? "API credentials set" : "no credentials"}
                      </p>
                    </div>
                  </div>
                  <Badge className={s.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                    {s.isActive ? "Active" : "Disabled"}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center text-xs">
                  <div><p className="text-lg font-extrabold">{s.productCount}</p><p className="text-muted-foreground">catalog items</p></div>
                  <div><p className="text-lg font-extrabold">{s.orderCount}</p><p className="text-muted-foreground">dropship orders</p></div>
                  <div><p className="text-sm font-bold leading-6">{s.lastSyncAt ? timeAgo(s.lastSyncAt) : "never"}</p><p className="text-muted-foreground">last sync</p></div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">Auto price: {s.autoSyncPrice ? "on" : "off"}</Badge>
                  <Badge variant="outline" className="text-[10px]">Auto stock: {s.autoSyncStock ? "on" : "off"}</Badge>
                  {s.lastSync && (
                    <Badge variant="outline" className={`text-[10px] ${s.lastSync.status === "FAILED" || s.lastSync.status === "PARTIAL" ? "border-rose-300 text-rose-600" : "border-emerald-300 text-emerald-600"}`}>
                      last {s.lastSync.type.toLowerCase()}: {s.lastSync.status.toLowerCase()}
                    </Badge>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button size="sm" className="rounded-lg" onClick={() => sync(s.id, "PRODUCTS")} disabled={Boolean(syncing) || !s.isActive}>
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing === `${s.id}-PRODUCTS` ? "animate-spin" : ""}`} /> Sync Products
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => sync(s.id, "PRICES")} disabled={Boolean(syncing) || !s.isActive}>
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing === `${s.id}-PRICES` ? "animate-spin" : ""}`} /> Prices
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => sync(s.id, "STOCK")} disabled={Boolean(syncing) || !s.isActive}>
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing === `${s.id}-STOCK` ? "animate-spin" : ""}`} /> Stock
                  </Button>
                  <Button size="sm" variant="outline" className="ml-auto rounded-lg" onClick={() => openEdit(s)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => toggleActive(s)}><Power className="mr-1.5 h-3.5 w-3.5" />{s.isActive ? "Disable" : "Enable"}</Button>
                  <Button size="sm" variant="outline" className="rounded-lg" asChild>
                    <Link href={`/admin/suppliers/${s.id}`}><Package className="mr-1.5 h-3.5 w-3.5" /> Manage</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="s-name">Name *</Label>
                <Input id="s-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dhaka Wholesale Hub" className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="s-code">Code *</Label>
                <Input id="s-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="DWH" className="rounded-xl font-mono uppercase" disabled={Boolean(editing)} />
              </div>
            </div>
            <div>
              <Label>Adapter</Label>
              <Select value={form.adapter} onValueChange={(v) => setForm((f) => ({ ...f, adapter: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(data?.adapters ?? []).map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{data?.adapters.find((a) => a.key === form.adapter)?.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="s-email">Email</Label>
                <Input id="s-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="s-phone">Phone</Label>
                <Input id="s-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="rounded-xl" />
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">API credentials (server-side only)</p>
              <div className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="s-url">API base URL</Label>
                  <Input id="s-url" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.supplier.com/v1" className="rounded-xl font-mono text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="s-key">API key</Label>
                    <Input id="s-key" type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={editing?.hasApiKey ? "•••••• (keep existing)" : "key"} className="rounded-xl font-mono text-sm" autoComplete="new-password" />
                  </div>
                  <div>
                    <Label htmlFor="s-secret">API secret</Label>
                    <Input id="s-secret" type="password" value={form.apiSecret} onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} placeholder={editing?.hasApiKey ? "•••••• (keep existing)" : "secret"} className="rounded-xl font-mono text-sm" autoComplete="new-password" />
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="s-markup">Markup %</Label>
                <Input id="s-markup" type="number" min={0} max={500} value={form.markupPercent} onChange={(e) => setForm((f) => ({ ...f, markupPercent: Number(e.target.value) }))} className="rounded-xl" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-3">
                <span className="text-xs font-medium">Auto price</span>
                <Switch checked={form.autoSyncPrice} onCheckedChange={(v) => setForm((f) => ({ ...f, autoSyncPrice: v }))} aria-label="Auto sync price" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-3">
                <span className="text-xs font-medium">Auto stock</span>
                <Switch checked={form.autoSyncStock} onCheckedChange={(v) => setForm((f) => ({ ...f, autoSyncStock: v }))} aria-label="Auto sync stock" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
              <span className="text-sm font-medium">Active</span>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} aria-label="Supplier active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name || !form.code}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
