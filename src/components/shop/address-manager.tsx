"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MapPin, Plus, Star, Trash2, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  area: string | null;
  postalCode: string | null;
  isDefault: boolean;
}

const EMPTY = { label: "Home", fullName: "", phone: "", line1: "", line2: "", city: "", area: "", postalCode: "", isDefault: false };

export function AddressManager({ initialAddresses }: { initialAddresses: Address[] }) {
  const [addresses, setAddresses] = useState<Address[]>(initialAddresses);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setOpen(true);
  };

  const openEdit = (a: Address) => {
    setEditing(a);
    setForm({
      label: a.label, fullName: a.fullName, phone: a.phone, line1: a.line1,
      line2: a.line2 ?? "", city: a.city, area: a.area ?? "", postalCode: a.postalCode ?? "", isDefault: a.isDefault,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!/^01[3-9]\d{8}$/.test(form.phone.trim())) {
      toast.error("Enter a valid mobile number (01XXXXXXXXX)");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/account/addresses/${editing.id}` : "/api/account/addresses", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label || "Home",
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          line1: form.line1.trim(),
          line2: form.line2.trim() || null,
          city: form.city.trim(),
          area: form.area.trim() || null,
          postalCode: form.postalCode.trim() || null,
          isDefault: form.isDefault,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editing ? "Address updated" : "Address added");
        setOpen(false);
        // Refresh list
        const list = await fetch("/api/account/addresses").then((r) => r.json());
        if (list.success) setAddresses(list.data);
      } else {
        toast.error(data.error ?? "Could not save address");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAddresses((list) => list.filter((a) => a.id !== id));
        toast.success("Address removed");
      }
    } catch {
      toast.error("Could not remove address");
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <div
            key={a.id}
            className={cn(
              "rounded-2xl border bg-card p-5",
              a.isDefault ? "border-brand-500 ring-1 ring-brand-500/30" : "border-border"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-600 dark:bg-brand-100">
                  <MapPin className="h-4 w-4" />
                </div>
                <p className="font-semibold">{a.label}</p>
                {a.isDefault && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700 dark:bg-brand-100 dark:text-brand-600">
                    <Star className="mr-0.5 inline h-2.5 w-2.5" /> Default
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(a)} aria-label="Edit address">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => remove(a.id)} aria-label="Delete address">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-3 text-sm">
              <p className="font-medium">{a.fullName} · {a.phone}</p>
              <p className="mt-0.5 text-muted-foreground">
                {a.line1}{a.area ? `, ${a.area}` : ""}, {a.city}{a.postalCode ? ` - ${a.postalCode}` : ""}
              </p>
            </div>
          </div>
        ))}

        <button
          onClick={openNew}
          className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-5 text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          <Plus className="h-6 w-6" />
          <span className="text-sm font-semibold">Add New Address</span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit address" : "Add new address"}</DialogTitle>
            <DialogDescription>Use a label like Home, Office or Parents to tell them apart.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto p-1 refined-scroll sm:grid-cols-2">
            <div>
              <Label htmlFor="label">Label</Label>
              <Input id="label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Home" />
            </div>
            <div>
              <Label htmlFor="fullName">Full name *</Label>
              <Input id="fullName" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="phone">Mobile *</Label>
              <Input id="phone" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="01XXXXXXXXX" />
            </div>
            <div>
              <Label htmlFor="city">City *</Label>
              <Input id="city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="line1">Address line *</Label>
              <Input id="line1" value={form.line1} onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))} placeholder="House, Road" />
            </div>
            <div>
              <Label htmlFor="area">Area</Label>
              <Input id="area" value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="postalCode">Postal code</Label>
              <Input id="postalCode" value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="h-4 w-4 rounded accent-[var(--brand-600)]"
              />
              Set as default delivery address
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Add Address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
