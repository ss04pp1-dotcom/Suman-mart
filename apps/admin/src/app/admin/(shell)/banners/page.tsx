"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, ImageUp, LayoutDashboard, Loader2, Megaphone, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRef } from "react";

interface BannerRow {
  id: string; title: string; subtitle: string | null; imageUrl: string; buttonLabel: string | null;
  buttonUrl: string | null; placement: string; theme: string; sortOrder: number;
  startsAt: string; endsAt: string | null; isActive: boolean;
}
interface SectionRow { key: string; title: string; subtitle: string | null; isActive: boolean; sortOrder: number }

export default function BannersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BannerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "", subtitle: "", imageUrl: "", buttonLabel: "Shop Now", buttonUrl: "/products",
    placement: "HERO", theme: "Dark", sortOrder: 0, startsAt: new Date().toISOString().slice(0, 10),
    endsAt: "", isActive: true,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-banners"],
    queryFn: async () => {
      const res = await fetch("/api/admin/banners");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { banners: BannerRow[]; sections: SectionRow[] };
    },
  });

  const openNew = (placement: string) => {
    setEditing(null);
    setForm({
      title: "", subtitle: "", imageUrl: "", buttonLabel: "Shop Now", buttonUrl: "/products",
      placement, theme: "Dark", sortOrder: (data?.banners.filter((b) => b.placement === placement).length ?? 0) + 1,
      startsAt: new Date().toISOString().slice(0, 10), endsAt: "", isActive: true,
    });
    setOpen(true);
  };

  const openEdit = (b: BannerRow) => {
    setEditing(b);
    setForm({
      title: b.title, subtitle: b.subtitle ?? "", imageUrl: b.imageUrl,
      buttonLabel: b.buttonLabel ?? "", buttonUrl: b.buttonUrl ?? "",
      placement: b.placement, theme: b.theme, sortOrder: b.sortOrder,
      startsAt: new Date(b.startsAt).toISOString().slice(0, 10),
      endsAt: b.endsAt ? new Date(b.endsAt).toISOString().slice(0, 10) : "",
      isActive: b.isActive,
    });
    setOpen(true);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "banners");
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (json.success) setForm((f) => ({ ...f, imageUrl: json.data.url }));
    else toast.error(json.error ?? "Upload failed");
    setUploading(false);
  };

  const save = async () => {
    if (!form.title.trim() || !form.imageUrl) return toast.error("Title and image are required");
    setSaving(true);
    try {
      const payload = { ...form, startsAt: form.startsAt, expiresAt: form.endsAt || null };
      const res = await fetch("/api/admin/banners", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, id: editing.id } : payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editing ? "Banner updated" : "Banner created");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      } else toast.error(json.error ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleBanner = async (b: BannerRow) => {
    const res = await fetch("/api/admin/banners", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, isActive: !b.isActive }),
    });
    if ((await res.json()).success) {
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
    }
  };

  const remove = async (b: BannerRow) => {
    if (!confirm(`Delete banner "${b.title}"?`)) return;
    const res = await fetch(`/api/admin/banners?id=${b.id}`, { method: "DELETE" });
    if ((await res.json()).success) {
      toast.success("Banner deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
    }
  };

  const toggleSection = async (s: SectionRow) => {
    const res = await fetch("/api/admin/banners", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId: s.key, isActive: !s.isActive }),
    });
    if ((await res.json()).success) {
      toast.success(`${s.title} ${!s.isActive ? "shown" : "hidden"} on homepage`);
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
    }
  };

  const banners = data?.banners ?? [];
  const heroes = banners.filter((b) => b.placement === "HERO");
  const promos = banners.filter((b) => b.placement === "PROMO");

  return (
    <div>
      <AdminPageHeader
        title="Banners & Homepage"
        description="Hero banners, promo strips and homepage section visibility"
        actions={<Button className="rounded-xl" onClick={() => openNew("HERO")}><Plus className="mr-2 h-4 w-4" /> New Banner</Button>}
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
        </div>
      ) : (
        <>
          {/* Hero banners */}
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Hero Banners</h3>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={() => openNew("HERO")}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add hero</Button>
            </div>
            {heroes.length === 0 ? (
              <AdminEmptyState className="py-8" icon={Megaphone} title="No hero banners" action={<Button size="sm" onClick={() => openNew("HERO")}>Create one</Button>} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {heroes.map((b) => (
                  <Card key={b.id} className="overflow-hidden">
                    <div className="relative aspect-[16/7] bg-muted/40">
                      <Image src={b.imageUrl} alt={b.title} fill sizes="400px" className="object-cover" />
                      <div className={`absolute inset-0 flex flex-col justify-center gap-1 bg-gradient-to-r p-4 ${b.theme === "Dark" ? "from-slate-950/80 to-transparent" : "from-white/80 to-transparent"}`}>
                        <p className={`text-sm font-extrabold ${b.theme === "Dark" ? "text-white" : "text-slate-900"}`}>{b.title}</p>
                        <p className={`line-clamp-1 text-xs ${b.theme === "Dark" ? "text-slate-200" : "text-slate-700"}`}>{b.subtitle}</p>
                      </div>
                      {!b.isActive && <Badge className="absolute right-2 top-2 bg-slate-900 text-white hover:bg-slate-900">Hidden</Badge>}
                    </div>
                    <CardContent className="p-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 rounded-lg" onClick={() => openEdit(b)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => toggleBanner(b)}>{b.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
                        <Button size="sm" variant="outline" className="rounded-lg text-rose-600" onClick={() => remove(b)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Promo banners */}
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Promotional Banners</h3>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={() => openNew("PROMO")}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add promo</Button>
            </div>
            {promos.length === 0 ? (
              <AdminEmptyState className="py-8" icon={ImageUp} title="No promo banners" />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {promos.map((b) => (
                  <Card key={b.id} className="overflow-hidden">
                    <div className="relative aspect-[21/6] bg-muted/40">
                      <Image src={b.imageUrl} alt={b.title} fill sizes="600px" className="object-cover" />
                      <div className="absolute inset-0 flex items-center bg-gradient-to-r from-slate-950/80 to-transparent p-4">
                        <div>
                          <p className="text-sm font-extrabold text-white">{b.title}</p>
                          <p className="line-clamp-1 text-xs text-slate-200">{b.subtitle}</p>
                        </div>
                      </div>
                      {!b.isActive && <Badge className="absolute right-2 top-2 bg-slate-900 text-white hover:bg-slate-900">Hidden</Badge>}
                    </div>
                    <CardContent className="p-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 rounded-lg" onClick={() => openEdit(b)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => toggleBanner(b)}>{b.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
                        <Button size="sm" variant="outline" className="rounded-lg text-rose-600" onClick={() => remove(b)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Homepage sections */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><LayoutDashboard className="h-4 w-4 text-brand-600" /> Homepage Sections</CardTitle>
              <CardDescription>Toggle which sections appear on the storefront homepage</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {(data?.sections ?? []).map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded-xl border border-border p-3.5">
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    {s.subtitle && <p className="text-xs text-muted-foreground">{s.subtitle}</p>}
                  </div>
                  <Switch checked={s.isActive} onCheckedChange={() => toggleSection(s)} aria-label={`Toggle ${s.title}`} />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit banner" : "New banner"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Image *</Label>
              <div className="flex items-center gap-3">
                <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40">
                  {form.imageUrl ? <Image src={form.imageUrl} alt="preview" fill sizes="128px" className="object-cover" /> : null}
                </div>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Upload
                </Button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
              </div>
            </div>
            <div>
              <Label htmlFor="b-title">Title *</Label>
              <Input id="b-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="b-sub">Subtitle</Label>
              <Input id="b-sub" value={form.subtitle} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="b-btn">Button label</Label>
                <Input id="b-btn" value={form.buttonLabel} onChange={(e) => setForm((f) => ({ ...f, buttonLabel: e.target.value }))} className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="b-url">Button URL</Label>
                <Input id="b-url" value={form.buttonUrl} onChange={(e) => setForm((f) => ({ ...f, buttonUrl: e.target.value }))} placeholder="/products?category=..." className="rounded-xl" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Placement</Label>
                <Select value={form.placement} onValueChange={(v) => setForm((f) => ({ ...f, placement: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HERO">Hero slider</SelectItem>
                    <SelectItem value="PROMO">Promo strip</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="b-sort">Order</Label>
                <Input id="b-sort" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} className="rounded-xl" />
              </div>
              <div>
                <Label>Theme</Label>
                <Select value={form.theme} onValueChange={(v) => setForm((f) => ({ ...f, theme: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dark">Dark text</SelectItem>
                    <SelectItem value="Light">Light text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="b-start">Starts</Label>
                <Input id="b-start" type="date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="b-end">Ends</Label>
                <Input id="b-end" type="date" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} className="rounded-xl" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
              <span className="text-sm font-medium">Active</span>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} aria-label="Banner active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.title || !form.imageUrl}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
