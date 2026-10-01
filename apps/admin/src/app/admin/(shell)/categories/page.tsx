"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Loader2, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRef } from "react";

interface CategoryRow {
  id: string; name: string; slug: string; description: string | null; imageUrl: string | null;
  sortOrder: number; isActive: boolean; productCount: number;
}

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", imageUrl: "", sortOrder: 0, isActive: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const res = await fetch("/api/admin/categories");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as CategoryRow[];
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", description: "", imageUrl: "", sortOrder: (data?.length ?? 0) + 1, isActive: true });
    setOpen(true);
  };

  const openEdit = (c: CategoryRow) => {
    setEditing(c);
    setForm({ name: c.name, description: c.description ?? "", imageUrl: c.imageUrl ?? "", sortOrder: c.sortOrder, isActive: c.isActive });
    setOpen(true);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "categories");
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (json.success) setForm((f) => ({ ...f, imageUrl: json.data.url }));
    else toast.error(json.error ?? "Upload failed");
    setUploading(false);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Category name is required");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/categories", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...form, id: editing.id } : form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editing ? "Category updated" : "Category created");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      } else toast.error(json.error ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: CategoryRow) => {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const res = await fetch(`/api/admin/categories?id=${c.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      toast.success("Category deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
    } else toast.error(json.error);
  };

  return (
    <div>
      <AdminPageHeader
        title="Categories"
        description={`${data?.length ?? "…"} product categories`}
        actions={<Button className="rounded-xl" onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New Category</Button>}
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <AdminEmptyState icon={Boxes} title="No categories yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.map((c) => (
            <Card key={c.id} className="group overflow-hidden">
              <div className="relative aspect-[16/9] bg-muted/40">
                {c.imageUrl ? (
                  <Image src={c.imageUrl} alt={c.name} fill sizes="300px" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground"><Boxes className="h-8 w-8" /></div>
                )}
                {!c.isActive && <Badge className="absolute right-2 top-2 bg-slate-900 text-white hover:bg-slate-900">Hidden</Badge>}
              </div>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{c.name}</p>
                  <Badge variant="outline">{c.productCount} items</Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{c.description ?? `/${c.slug}`}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 rounded-lg" onClick={() => openEdit(c)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="outline" className="rounded-lg" asChild>
                    <Link href={`/products?category=${c.slug}`} target="_blank">View</Link>
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg text-rose-600" onClick={() => remove(c)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "New category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cat-name">Name *</Label>
              <Input id="cat-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Electronics" className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="cat-desc">Description</Label>
              <Input id="cat-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short description" className="rounded-xl" />
            </div>
            <div>
              <Label>Image</Label>
              <div className="flex items-center gap-3">
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40">
                  {form.imageUrl ? <Image src={form.imageUrl} alt="preview" fill sizes="96px" className="object-cover" /> : null}
                </div>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Upload
                </Button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cat-sort">Sort order</Label>
                <Input id="cat-sort" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} className="rounded-xl" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-4">
                <span className="text-sm font-medium">Visible</span>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} aria-label="Category visible" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
