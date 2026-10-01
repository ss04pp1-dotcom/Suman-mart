"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X, PackageSearch, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { ProductCard, type ProductCardData } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  slug: string;
  productCount?: number;
}

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "best_selling", label: "Best Selling" },
  { value: "rating", label: "Highest Rated" },
  { value: "discount", label: "Biggest Discount" },
];

function ProductsListing() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "featured";
  const availability = params.get("availability") ?? "";
  const minPrice = params.get("minPrice") ?? "";
  const maxPrice = params.get("maxPrice") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value && value.length > 0) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      router.replace(`/products${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
    },
    [params, router]
  );

  const activeFilterCount = [category, tag, availability, minPrice, maxPrice].filter(Boolean).length;

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (tag) sp.set("tag", tag);
    if (sort) sp.set("sort", sort);
    if (availability) sp.set("availability", availability);
    if (minPrice) sp.set("minPrice", minPrice);
    if (maxPrice) sp.set("maxPrice", maxPrice);
    sp.set("page", String(page));
    sp.set("limit", "12");
    return sp.toString();
  }, [q, category, tag, sort, availability, minPrice, maxPrice, page]);

  const { data: categories } = useQuery({
    queryKey: ["shop-categories"],
    queryFn: async () => {
      const r = await fetch("/api/categories");
      const d = await r.json();
      return d.success ? (d.data as Category[]) : [];
    },
  });

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["shop-products", queryString],
    queryFn: async () => {
      const r = await fetch(`/api/products?${queryString}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error ?? "Failed to load products");
      return d.data as {
        items: ProductCardData[];
        total: number;
        totalPages: number;
        tags: { name: string; slug: string }[];
      };
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const tags = data?.tags ?? [];
  const error = queryError ? (queryError as Error).message : null;
  const categoryList = categories ?? [];

  const activeCategory = (categories ?? []).find((c) => c.slug === category);

  const FilterContent = (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-sm font-semibold">Categories</p>
        <RadioGroup
          value={category || "all"}
          onValueChange={(v) => setParam("category", v === "all" ? null : v)}
          className="gap-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="all" id="cat-all" />
            <Label htmlFor="cat-all" className="cursor-pointer font-normal">All categories</Label>
          </div>
          {categoryList.map((c) => (
            <div key={c.slug} className="flex items-center space-x-2">
              <RadioGroupItem value={c.slug} id={`cat-${c.slug}`} />
              <Label htmlFor={`cat-${c.slug}`} className="cursor-pointer font-normal">
                {c.name}
                {c.productCount !== undefined && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({c.productCount})</span>
                )}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold">Price range (৳)</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Min"
            defaultValue={minPrice}
            onBlur={(e) => setParam("minPrice", e.target.value || null)}
            aria-label="Minimum price"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Max"
            defaultValue={maxPrice}
            onBlur={(e) => setParam("maxPrice", e.target.value || null)}
            aria-label="Maximum price"
          />
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold">Availability</p>
        <RadioGroup
          value={availability || "all"}
          onValueChange={(v) => setParam("availability", v === "all" ? null : v)}
          className="gap-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="all" id="av-all" />
            <Label htmlFor="av-all" className="cursor-pointer font-normal">All items</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="in_stock" id="av-in" />
            <Label htmlFor="av-in" className="cursor-pointer font-normal">In stock only</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="out_of_stock" id="av-out" />
            <Label htmlFor="av-out" className="cursor-pointer font-normal">Out of stock</Label>
          </div>
        </RadioGroup>
      </div>

      {tags.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold">Tags</p>
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 10).map((t) => (
              <label
                key={t.slug}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  tag === t.slug
                    ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-600"
                    : "border-border text-muted-foreground hover:border-brand-300"
                )}
              >
                <Checkbox
                  checked={tag === t.slug}
                  onCheckedChange={(c) => setParam("tag", c ? t.slug : null)}
                  className="h-3.5 w-3.5"
                />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {activeFilterCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            const next = new URLSearchParams();
            if (q) next.set("q", q);
            if (sort) next.set("sort", sort);
            router.replace(`/products${next.toString() ? `?${next}` : ""}`, { scroll: false });
          }}
        >
          <X className="mr-1.5 h-4 w-4" /> Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {q ? `Search results for "${q}"` : activeCategory ? activeCategory.name : "All Products"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${total} product${total !== 1 ? "s" : ""} found`}
        </p>
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block" aria-label="Product filters">
          <div className="sticky top-36 rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-brand-600" />
              <p className="font-semibold">Filters</p>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {FilterContent}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Toolbar */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <Button variant="outline" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:block">Sort by</span>
              <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
                <SelectTrigger className="w-[170px] sm:w-[200px]" aria-label="Sort products">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-square w-full rounded-2xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={() => router.refresh()}>Try again</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-12 text-center">
              <PackageSearch className="h-12 w-12 text-muted-foreground/50" />
              <div>
                <p className="font-semibold">No products found</p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your filters or search for something else.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.replace("/products")}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                {items.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              {totalPages > 1 && (
                <Pagination className="mt-8">
                  <PaginationContent>
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={page <= 1}
                        onClick={() => setParam("page", String(page - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </PaginationItem>
                    {Array.from({ length: totalPages }).slice(0, 7).map((_, i) => {
                      const p = i + 1;
                      return (
                        <PaginationItem key={p}>
                          <Button
                            variant={p === page ? "default" : "ghost"}
                            size="icon"
                            onClick={() => setParam("page", String(p))}
                            aria-label={`Page ${p}`}
                            aria-current={p === page ? "page" : undefined}
                          >
                            {p}
                          </Button>
                        </PaginationItem>
                      );
                    })}
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={page >= totalPages}
                        onClick={() => setParam("page", String(page + 1))}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile filters */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-brand-600" /> Filters
            </SheetTitle>
          </SheetHeader>
          {FilterContent}
          <div className="mt-6">
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Show {total} results
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-8 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      }
    >
      <ProductsListing />
    </Suspense>
  );
}
