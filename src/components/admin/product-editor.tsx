"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, ImagePlus, Loader2, Package, Plus, Save, Star, Trash2, Upload, X, Sparkles,
} from "lucide-react";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Spec { group: string; key: string; value: string }
interface VariantForm { name: string; options: Record<string, string>; sku?: string; price?: number; stock: number }
interface ProductForm {
  name: string; slug: string; shortDescription: string; description: string;
  price: number | ""; compareAtPrice: number | ""; costPrice: number | "";
  sku: string; stock: number; lowStockThreshold: number; categoryId: string;
  brand: string; isActive: boolean; isFeatured: boolean;
  specifications: Spec[]; seoTitle: string; seoDescription: string;
  images: { url: string; alt?: string | null }[];
  tags: string[];
  variants: VariantForm[];
  relatedProductIds: string[];
  fbtProductIds: string[];
}

const EMPTY: ProductForm = {
  name: "", slug: "", shortDescription: "", description: "",
  price: "", compareAtPrice: "", costPrice: "", sku: "", stock: 0, lowStockThreshold: 5,
  categoryId: "", brand: "", isActive: true, isFeatured: false,
  specifications: [], seoTitle: "", seoDescription: "", images: [], tags: [], variants: [],
  relatedProductIds: [], fbtProductIds: [],
};

export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<ProductForm>(EMPTY);
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [variantGroupInput, setVariantGroupInput] = useState("");
  const [variantOptionsInput, setVariantOptionsInput] = useState("");
  const [allProducts, setAllProducts] = useState<{ id: string; name: string; price: number }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/categories").then((r) => r.json()).then((d) => d.success && setCategories(d.data)).catch(() => undefined);
    fetch("/api/admin/products?limit=60")
      .then((r) => r.json())
      .then((d) => d.success && setAllProducts(d.data.items.map((p: { id: string; name: string; price: number }) => ({ id: p.id, name: p.name, price: p.price }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!productId) return;
    fetch(`/api/admin/products/${productId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const p = d.data;
          setForm({
            name: p.name, slug: p.slug, shortDescription: p.shortDescription ?? "", description: p.description ?? "",
            price: p.price, compareAtPrice: p.compareAtPrice ?? "", costPrice: p.costPrice ?? "",
            sku: p.sku, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
            categoryId: p.category?.id ?? p.categoryId, brand: p.brand ?? "",
            isActive: p.isActive, isFeatured: p.isFeatured,
            specifications: p.specifications ?? [],
            seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "",
            images: (p.images ?? []).map((i: { url: string; alt?: string }) => ({ url: i.url, alt: i.alt })),
            tags: p.tags ?? [],
            variants: (p.variants ?? []).map((v: { name: string; options: Record<string, string>; sku?: string; price?: number; stock: number }) => ({
              name: v.name, options: v.options, sku: v.sku, price: v.price, stock: v.stock,
            })),
            relatedProductIds: p.relatedProductIds ?? [],
            fbtProductIds: p.fbtProductIds ?? [],
          });
        } else {
          toast.error("Product not found");
          router.push("/admin/products");
        }
      })
      .finally(() => setLoading(false));
  }, [productId, router]);

  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "products");
        const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.success) {
          setForm((f) => ({ ...f, images: [...f.images, { url: json.data.url, alt: f.name }] }));
        } else {
          toast.error(json.error ?? `Upload failed for ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addImageUrl = () => {
    const url = prompt("Image URL (or path like /products/x.jpg)");
    if (url?.trim()) set("images", [...form.images, { url: url.trim(), alt: form.name }]);
  };

  const save = async () => {
    if (!form.name || !form.sku || !form.categoryId || form.price === "") {
      toast.error("Name, SKU, price and category are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice === "" ? null : Number(form.compareAtPrice),
        costPrice: form.costPrice === "" ? null : Number(form.costPrice),
        images: form.images,
        specifications: form.specifications.filter((s) => s.key && s.value),
        variants: form.variants,
      };
      const res = await fetch(productId ? `/api/admin/products/${productId}` : "/api/admin/products", {
        method: productId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(productId ? "Product updated" : "Product created");
        router.push(`/admin/products/${json.data.id}`);
        if (!productId) router.refresh();
      } else {
        toast.error(json.error ?? "Save failed");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const discount = form.compareAtPrice !== "" && Number(form.compareAtPrice) > Number(form.price)
    ? Math.round(((Number(form.compareAtPrice) - Number(form.price)) / Number(form.compareAtPrice)) * 100)
    : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="rounded-xl">
            <Link href="/admin/products" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{productId ? "Edit Product" : "New Product"}</h2>
            {productId && form.slug && <p className="text-sm text-muted-foreground">/products/{form.slug}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" asChild>
            {productId ? <Link href={`/products/${form.slug}`} target="_blank">Preview in store</Link> : <Link href="/admin/products">Cancel</Link>}
          </Button>
          <Button onClick={save} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {productId ? "Save Changes" : "Create Product"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 no-scrollbar sm:w-fit">
          <TabsTrigger value="general" className="rounded-xl px-4 py-2 text-sm">General</TabsTrigger>
          <TabsTrigger value="pricing" className="rounded-xl px-4 py-2 text-sm">Pricing</TabsTrigger>
          <TabsTrigger value="images" className="rounded-xl px-4 py-2 text-sm">Images</TabsTrigger>
          <TabsTrigger value="variants" className="rounded-xl px-4 py-2 text-sm">Variants</TabsTrigger>
          <TabsTrigger value="specs" className="rounded-xl px-4 py-2 text-sm">Specifications</TabsTrigger>
          <TabsTrigger value="seo" className="rounded-xl px-4 py-2 text-sm">SEO</TabsTrigger>
          <TabsTrigger value="recos" className="rounded-xl px-4 py-2 text-sm">Recommendations</TabsTrigger>
        </TabsList>

        {/* GENERAL */}
        <TabsContent value="general" className="mt-4">
          <Card><CardContent className="grid gap-5 p-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Product name *</Label>
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Wireless Earbuds Pro" className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="slug">URL slug</Label>
              <Input id="slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto-generated from name" className="rounded-xl font-mono text-sm" />
            </div>
            <div>
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. SoundCore" className="rounded-xl" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="short">Short description</Label>
              <Input id="short" value={form.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} placeholder="One-line summary shown on cards" className="rounded-xl" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="desc">Full description</Label>
              <Textarea id="desc" rows={6} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Detailed product description…" className="rounded-xl" />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (tagInput.trim()) {
                        set("tags", [...new Set([...form.tags, tagInput.trim()])]);
                        setTagInput("");
                      }
                    }
                  }}
                  placeholder="Type and press Enter"
                  className="rounded-xl"
                />
              </div>
              {form.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="gap-1">
                      {t}
                      <button onClick={() => set("tags", form.tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4 sm:col-span-2">
              <div>
                <p className="text-sm font-semibold">Published</p>
                <p className="text-xs text-muted-foreground">Visible to customers in the storefront</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} aria-label="Published" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-4 sm:col-span-2">
              <div>
                <p className="text-sm font-semibold">Featured</p>
                <p className="text-xs text-muted-foreground">Shown in the Featured Products section</p>
              </div>
              <Switch checked={form.isFeatured} onCheckedChange={(v) => set("isFeatured", v)} aria-label="Featured" />
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* PRICING */}
        <TabsContent value="pricing" className="mt-4">
          <Card><CardContent className="grid gap-5 p-6 sm:grid-cols-2">
            <div>
              <Label htmlFor="price">Selling price (৳) *</Label>
              <Input id="price" type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value === "" ? "" : Number(e.target.value))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="compareAt">Compare-at price (৳)</Label>
              <Input id="compareAt" type="number" min={0} value={form.compareAtPrice} onChange={(e) => set("compareAtPrice", e.target.value === "" ? "" : Number(e.target.value))} className="rounded-xl" />
              {discount && <p className="mt-1 text-xs font-semibold text-rose-500">Shows as −{discount}% off</p>}
            </div>
            <div>
              <Label htmlFor="cost">Cost price (৳)</Label>
              <Input id="cost" type="number" min={0} value={form.costPrice} onChange={(e) => set("costPrice", e.target.value === "" ? "" : Number(e.target.value))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="sku">SKU *</Label>
              <Input id="sku" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="SN-XXXX" className="rounded-xl font-mono" />
            </div>
            <div>
              <Label htmlFor="stock">Stock quantity *</Label>
              <Input id="stock" type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} className="rounded-xl" />
            </div>
            <div>
              <Label htmlFor="lowStock">Low stock threshold</Label>
              <Input id="lowStock" type="number" min={0} value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", Number(e.target.value))} className="rounded-xl" />
              <p className="mt-1 text-xs text-muted-foreground">Triggers a low-stock notification</p>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* IMAGES */}
        <TabsContent value="images" className="mt-4">
          <Card><CardContent className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload Images
              </Button>
              <Button type="button" variant="outline" className="rounded-xl" onClick={addImageUrl}>
                <ImagePlus className="mr-2 h-4 w-4" /> Add by URL
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => uploadImages(e.target.files)} />
              <p className="text-xs text-muted-foreground">JPG/PNG/WebP up to 5MB · first image is the main photo</p>
            </div>

            {form.images.length === 0 ? (
              <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-10 text-center">
                <Package className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No images yet — upload or add by URL</p>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {form.images.map((img, i) => (
                  <div key={`${img.url}-${i}`} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                                        <img src={img.url} alt={img.alt ?? ""} className="h-full w-full object-cover" />
                    {i === 0 && <Badge className="absolute left-2 top-2 bg-brand-600 hover:bg-brand-600">Main</Badge>}
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-slate-950/70 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded p-1 text-white hover:bg-white/20 disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => set("images", [form.images[i], ...form.images.filter((_, j) => j !== i)])}
                        aria-label="Make main image"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-white hover:bg-white/20"
                        onClick={() => set("images", form.images.filter((_, j) => j !== i))}
                        aria-label="Remove image"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* VARIANTS */}
        <TabsContent value="variants" className="mt-4">
          <Card><CardContent className="p-6">
            <div className="grid gap-3 rounded-2xl border border-dashed border-border p-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
              <div>
                <Label htmlFor="vg">Group name</Label>
                <Input id="vg" value={variantGroupInput} onChange={(e) => setVariantGroupInput(e.target.value)} placeholder="e.g. Size" className="rounded-xl" />
              </div>
              <div>
                <Label htmlFor="vo">Options (comma separated)</Label>
                <Input id="vo" value={variantOptionsInput} onChange={(e) => setVariantOptionsInput(e.target.value)} placeholder="e.g. S, M, L, XL" className="rounded-xl" />
              </div>
              <Button
                type="button"
                className="rounded-xl"
                onClick={() => {
                  if (!variantGroupInput.trim() || !variantOptionsInput.trim()) return;
                  const options = variantOptionsInput.split(",").map((o) => o.trim()).filter(Boolean);
                  const stock = Math.max(1, Math.floor(20 / options.length));
                  set("variants", [
                    ...form.variants,
                    ...options.map((o) => ({ name: variantGroupInput.trim(), options: { [variantGroupInput.trim()]: o }, stock })),
                  ]);
                  setVariantGroupInput("");
                  setVariantOptionsInput("");
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add
              </Button>
            </div>

            {form.variants.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No variants — the product sells as a single item using the main stock.
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                {form.variants.map((v, i) => (
                  <div key={i} className="grid grid-cols-2 items-center gap-3 border-b border-border/60 p-3 last:border-0 odd:bg-muted/30 sm:grid-cols-5">
                    <Input
                      value={v.name}
                      onChange={(e) => set("variants", form.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      className="rounded-lg text-sm"
                      aria-label="Variant group"
                    />
                    <Input
                      value={Object.values(v.options)[0] ?? ""}
                      onChange={(e) => {
                        const key = Object.keys(v.options)[0] ?? v.name;
                        set("variants", form.variants.map((x, j) => (j === i ? { ...x, options: { [key]: e.target.value } } : x)));
                      }}
                      className="rounded-lg text-sm"
                      aria-label="Variant value"
                    />
                    <Input
                      type="number"
                      value={v.price ?? ""}
                      placeholder="= price"
                      onChange={(e) => set("variants", form.variants.map((x, j) => (j === i ? { ...x, price: e.target.value === "" ? undefined : Number(e.target.value) } : x)))}
                      className="rounded-lg text-sm"
                      aria-label="Variant price"
                    />
                    <Input
                      type="number"
                      value={v.stock}
                      onChange={(e) => set("variants", form.variants.map((x, j) => (j === i ? { ...x, stock: Number(e.target.value) } : x)))}
                      className="rounded-lg text-sm"
                      aria-label="Variant stock"
                    />
                    <Button variant="ghost" size="icon" className="justify-self-end rounded-lg text-rose-600" onClick={() => set("variants", form.variants.filter((_, j) => j !== i))} aria-label="Remove variant">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* SPECS */}
        <TabsContent value="specs" className="mt-4">
          <Card><CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Technical specifications shown in the Specifications tab</p>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => set("specifications", [...form.specifications, { group: "", key: "", value: "" }])}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Row
              </Button>
            </div>
            {form.specifications.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No specifications yet</p>
            ) : (
              <div className="space-y-2">
                {form.specifications.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                    <Input placeholder="Group (e.g. Display)" value={s.group} onChange={(e) => set("specifications", form.specifications.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))} className="rounded-lg text-sm" aria-label="Spec group" />
                    <Input placeholder="Key (e.g. Screen)" value={s.key} onChange={(e) => set("specifications", form.specifications.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="rounded-lg text-sm" aria-label="Spec key" />
                    <Input placeholder="Value (e.g. 1.9 inch AMOLED)" value={s.value} onChange={(e) => set("specifications", form.specifications.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="rounded-lg text-sm" aria-label="Spec value" />
                    <Button variant="ghost" size="icon" className="rounded-lg text-rose-600" onClick={() => set("specifications", form.specifications.filter((_, j) => j !== i))} aria-label="Remove spec"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* SEO */}
        <TabsContent value="seo" className="mt-4">
          <Card><CardContent className="space-y-5 p-6">
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input id="seoTitle" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} placeholder={`${form.name || "Product"} — Buy Online in Bangladesh | ShopNest`} className="rounded-xl" />
              <p className="mt-1 text-xs text-muted-foreground">{(form.seoTitle || form.name).length}/60 characters recommended</p>
            </div>
            <div>
              <Label htmlFor="seoDesc">Meta description</Label>
              <Textarea id="seoDesc" rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} placeholder="Appears in search engine results…" className="rounded-xl" />
              <p className="mt-1 text-xs text-muted-foreground">{(form.seoDescription || form.shortDescription).length}/160 characters recommended</p>
            </div>
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Search preview</p>
              <div className="mt-2">
                <p className="text-sm text-sky-600">{form.seoTitle || `${form.name || "Product"} — Buy Online`}</p>
                <p className="text-xs text-emerald-700">https://shopnest.com.bd/products/{form.slug || "product-slug"}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{form.seoDescription || form.shortDescription || "Meta description will appear here."}</p>
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
              Product structured data (JSON-LD with price, availability and ratings) is generated automatically for search engines.
            </p>
          </CardContent></Card>
        </TabsContent>

        {/* RECOMMENDATIONS */}
        <TabsContent value="recos" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {([["relatedProductIds", "You May Also Like"], ["fbtProductIds", "Frequently Bought Together"]] as const).map(([key, title]) => (
              <Card key={key}>
                <CardContent className="p-5">
                  <p className="font-bold">{title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key === "relatedProductIds"
                      ? "Manual picks shown on the product page. Auto-recommendations fill remaining slots."
                      : "Products bundled in the Frequently Bought Together section."}
                  </p>
                  <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-border p-2 refined-scroll">
                    {allProducts
                      .filter((p) => p.id !== productId)
                      .map((p) => {
                        const checked = (form[key] as string[]).includes(p.id);
                        return (
                          <label key={p.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${checked ? "bg-brand-50 dark:bg-brand-100" : "hover:bg-muted/60"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                set(key, checked ? (form[key] as string[]).filter((x) => x !== p.id) : [...(form[key] as string[]), p.id])
                              }
                              className="h-4 w-4 rounded accent-[var(--brand-600)]"
                            />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="text-xs text-muted-foreground">{formatBDT(p.price)}</span>
                          </label>
                        );
                      })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{(form[key] as string[]).length} selected</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
