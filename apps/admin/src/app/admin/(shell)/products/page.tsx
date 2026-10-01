"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Copy, Download, Layers, PackageSearch, Plus,
  RotateCcw, Search, Star, Trash2, TriangleAlert, Power,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminEmptyState } from "@/components/admin/empty-state";
import { formatBDT } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProductRow {
  id: string; name: string; slug: string; price: number; compareAtPrice: number | null;
  stock: number; lowStockThreshold: number; isActive: boolean; isFeatured: boolean;
  sku: string; rating: number; reviewCount: number; soldCount: number; imageUrl: string | null;
  category: { id: string; name: string } | null;
}

export default function AdminProductsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ q: "", category: "", status: "", stock: "", page: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<{ action: string; label: string; needsValue?: boolean } | null>(null);
  const [bulkValue, setBulkValue] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, String(v)));
      params.set("limit", "12");
      const res = await fetch(`/api/admin/products?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        items: ProductRow[]; total: number; page: number; totalPages: number;
        categories: { id: string; name: string }[];
      };
    },
  });

  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value, page: key === "page" ? Number(value) : 1 }));
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleActive = async (p: ProductRow) => {
    const res = await fetch(`/api/admin/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    const json = await res.json();
    if (json.success) {
      toast.success(p.isActive ? "Product unpublished" : "Product published");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } else toast.error(json.error);
  };

  const duplicate = async (p: ProductRow) => {
    const res = await fetch(`/api/admin/products/${p.id}`);
    const detail = await res.json();
    if (!detail.success) return toast.error("Could not load product");
    const { id, createdAt, updatedAt, ...product } = detail.data;
    const res2 = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...product, name: `${p.name} (Copy)`, sku: `${p.sku}-COPY`, slug: undefined }),
    });
    const json = await res2.json();
    if (json.success) {
      toast.success("Product duplicated");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } else toast.error(json.error ?? "Duplicate failed");
  };

  const deleteProduct = async (p: ProductRow) => {
    if (!confirm(`Delete "${p.name}"? Products with order history are archived instead.`)) return;
    const res = await fetch(`/api/admin/products/${p.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      toast.success(json.data.archived ? "Product archived (has orders)" : "Product deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } else toast.error(json.error);
  };

  const runBulk = async () => {
    if (!bulkDialog) return;
    const res = await fetch("/api/admin/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [...selected],
        action: bulkDialog.action,
        value: bulkDialog.needsValue ? (bulkDialog.action === "adjustPrice" ? Number(bulkValue) : Number(bulkValue)) : undefined,
      }),
    });
    const json = await res.json();
    if (json.success) {
      toast.success(`Bulk action applied to ${json.data.affected} product(s)`);
      setBulkDialog(null);
      setBulkValue("");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } else toast.error(json.error);
  };

  return (
    <div>
      <AdminPageHeader
        title="Products"
        description={`${data?.total ?? "…"} products in catalog`}
        actions={
          <>
            <Button variant="outline" className="rounded-xl bg-card" asChild>
              {/* CSV download — plain anchor on purpose (see customers page note). */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/admin/reports/export?type=products&range=30d"><Download className="mr-2 h-4 w-4" /> Export</a>
            </Button>
            <Button className="rounded-xl" asChild>
              <Link href="/admin/products/new"><Plus className="mr-2 h-4 w-4" /> Add Product</Link>
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.q} onChange={(e) => setFilter("q", e.target.value)} placeholder="Search by name, SKU or brand…" className="h-10 rounded-xl pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={filters.category || "all_cat"} onValueChange={(v) => setFilter("category", v === "all_cat" ? "" : v)}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl" aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_cat">All categories</SelectItem>
                {(data?.categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status || "all_status"} onValueChange={(v) => setFilter("status", v === "all_status" ? "" : v)}>
              <SelectTrigger className="h-10 w-[130px] rounded-xl" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_status">All status</SelectItem>
                <SelectItem value="active">Published</SelectItem>
                <SelectItem value="inactive">Unpublished</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.stock || "all_stock"} onValueChange={(v) => setFilter("stock", v === "all_stock" ? "" : v)}>
              <SelectTrigger className="h-10 w-[140px] rounded-xl" aria-label="Stock"><SelectValue placeholder="Stock" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_stock">All stock</SelectItem>
                <SelectItem value="low">Low stock</SelectItem>
                <SelectItem value="out">Out of stock</SelectItem>
              </SelectContent>
            </Select>
            {(filters.q || filters.category || filters.status || filters.stock) && (
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={() => setFilters({ q: "", category: "", status: "", stock: "", page: 1 })} aria-label="Reset">
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-100/30 dark:bg-brand-100/10">
          <p className="text-sm font-semibold">{selected.size} selected</p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => setBulkDialog({ action: "activate", label: "publish" })}>Publish</Button>
            <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => setBulkDialog({ action: "deactivate", label: "unpublish" })}>Unpublish</Button>
            <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => setBulkDialog({ action: "feature", label: "feature" })}>Feature</Button>
            <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => setBulkDialog({ action: "setStock", label: "set stock for", needsValue: true })}>Set Stock</Button>
            <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => setBulkDialog({ action: "adjustPrice", label: "adjust price by % for", needsValue: true })}>Adjust Price ±%</Button>
            <Button size="sm" variant="outline" className="rounded-lg bg-card text-rose-600 hover:text-rose-600" onClick={() => setBulkDialog({ action: "delete", label: "delete" })}>Delete</Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <Card><CardContent className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </CardContent></Card>
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState
          icon={PackageSearch}
          title="No products found"
          description="Try adjusting filters or add your first product."
          action={<Button asChild className="rounded-xl"><Link href="/admin/products/new"><Plus className="mr-2 h-4 w-4" /> Add Product</Link></Button>}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={data.items.length > 0 && selected.size === data.items.length}
                          onCheckedChange={(c) => setSelected(c ? new Set(data.items.map((i) => i.id)) : new Set())}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Stock</TableHead>
                      <TableHead>Sold</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((p) => {
                      const low = p.stock <= p.lowStockThreshold;
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                                                            {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="h-11 w-11 shrink-0 rounded-lg object-cover" />}
                              <div className="min-w-0">
                                <Link href={`/admin/products/${p.id}`} className="line-clamp-1 text-sm font-semibold hover:text-brand-600">{p.name}</Link>
                                <p className="text-xs text-muted-foreground">
                                  SKU {p.sku}
                                  {p.rating > 0 && <> · <Star className="inline h-3 w-3 fill-amber-400 text-amber-400" /> {p.rating} ({p.reviewCount})</>}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.category?.name ?? "—"}</TableCell>
                          <TableCell>
                            <p className="text-sm font-semibold">{formatBDT(p.price)}</p>
                            {p.compareAtPrice && <p className="text-xs text-muted-foreground line-through">{formatBDT(p.compareAtPrice)}</p>}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${p.stock === 0 ? "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : low ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"}`}>
                              {p.stock === 0 ? <TriangleAlert className="h-3 w-3" /> : null}
                              {p.stock}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{p.soldCount}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={p.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                                {p.isActive ? "Published" : "Draft"}
                              </Badge>
                              {p.isFeatured && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400">Featured</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Actions"><Layers className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem asChild><Link href={`/admin/products/${p.id}`}>Edit product</Link></DropdownMenuItem>
                                <DropdownMenuItem asChild><Link href={`/products/${p.slug}`} target="_blank">View in store</Link></DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toggleActive(p)}>
                                  <Power className="mr-2 h-3.5 w-3.5" /> {p.isActive ? "Unpublish" : "Publish"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => duplicate(p)}><Copy className="mr-2 h-3.5 w-3.5" /> Duplicate</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => deleteProduct(p)}>
                                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-border md:hidden">
                {data.items.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-4">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} />
                                        {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/products/${p.id}`} className="line-clamp-1 text-sm font-semibold">{p.name}</Link>
                      <p className="text-xs text-muted-foreground">{formatBDT(p.price)} · stock {p.stock} · {p.soldCount} sold</p>
                    </div>
                    <Badge className={p.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400"}>
                      {p.isActive ? "Live" : "Draft"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page <= 1} onClick={() => setFilter("page", String(data.page - 1))} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={data.page >= data.totalPages} onClick={() => setFilter("page", String(data.page + 1))} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bulk confirm dialog */}
      <Dialog open={Boolean(bulkDialog)} onOpenChange={(open) => !open && setBulkDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {bulkDialog?.action === "delete" ? "Delete" : "Apply"} {selected.size} product(s)?
            </DialogTitle>
            <DialogDescription>
              {bulkDialog?.needsValue
                ? `Enter a value to ${bulkDialog.label} the selected products.`
                : `This will ${bulkDialog?.label} the selected products. Products with orders are archived instead of deleted.`}
            </DialogDescription>
          </DialogHeader>
          {bulkDialog?.needsValue && (
            <Input
              type="number"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              placeholder={bulkDialog.action === "adjustPrice" ? "e.g. 10 or -15 (percent)" : "e.g. 25 (units)"}
              className="rounded-xl"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)}>Cancel</Button>
            <Button onClick={runBulk} disabled={bulkDialog?.needsValue && !bulkValue}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
