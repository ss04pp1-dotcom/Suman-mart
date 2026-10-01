"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import {
  Heart,
  Menu,
  Package,
  Search,
  ShoppingBag,
  User,
  ChevronDown,
  LogIn,
  LogOut,
  PackageSearch,
  Settings2,
  X,
} from "lucide-react";
import { useCart } from "@/lib/stores/cart";
import { useWishlist } from "@/lib/stores/wishlist";
import { track } from "@/lib/tracking-client";
import { formatBDT } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface HeaderCategory {
  name: string;
  slug: string;
}

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  price: number;
  imageUrl: string | null;
}

export function Header({ categories, storeName }: { categories: HeaderCategory[]; storeName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCart();
  const wishlist = useWishlist();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [mobileSearch, setMobileSearch] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d?.data?.customer ?? null))
      .catch(() => setUser(null));
  }, [pathname]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const onSearchInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(value.trim())}&limit=5`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setSuggestions(d.data.items);
            setShowSuggestions(true);
          }
        })
        .catch(() => undefined);
    }, 300);
  };

  const doSearch = (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setShowSuggestions(false);
    setMobileSearch(false);
    track("Search", {
      searchQuery: term,
      searchResults: suggestions.length,
    });
    router.push(`/products?q=${encodeURIComponent(term)}`);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    router.push("/");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md">
      {/* Announcement bar */}
      <div className="gradient-brand">
        <p className="mx-auto max-w-7xl px-4 py-1.5 text-center text-xs font-medium text-white">
          Free delivery on orders over ৳2,000 · Cash on delivery available nationwide
        </p>
      </div>

      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 items-center gap-3 sm:gap-6">
          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <nav className="flex h-full flex-col">
                <div className="flex items-center gap-2 border-b border-border p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand text-white">
                    <Package className="h-5 w-5" />
                  </div>
                  <span className="text-lg font-bold">ShopNest</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <p className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Categories
                  </p>
                  {categories.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/products?category=${c.slug}`}
                      className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted"
                    >
                      {c.name}
                    </Link>
                  ))}
                  <p className="px-3 pb-2 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Help
                  </p>
                  <Link href="/track-order" className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted">
                    Track Order
                  </Link>
                  <Link href="/products" className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted">
                    All Products
                  </Link>
                </div>
              </nav>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand text-white shadow-sm">
              <Package className="h-5 w-5" />
            </div>
            <span className="hidden text-lg font-extrabold tracking-tight sm:block">{storeName}</span>
          </Link>

          {/* Desktop search */}
          <div ref={searchRef} className="relative hidden flex-1 md:block">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doSearch();
              }}
              className="relative"
            >
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => onSearchInput(e.target.value)}
                onFocus={() => query.length >= 2 && setShowSuggestions(true)}
                placeholder="Search products, brands and more…"
                className="h-11 rounded-full border-border bg-muted/50 pl-10 pr-4 focus-visible:ring-brand-600"
                aria-label="Search products"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSuggestions([]);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-card-hover">
                {suggestions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/products/${s.slug}`}
                    onClick={() => setShowSuggestions(false)}
                    className="flex items-center gap-3 border-b border-border/60 p-3 last:border-0 hover:bg-muted/50"
                  >
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                      {s.imageUrl && <Image src={s.imageUrl} alt={s.name} fill sizes="48px" className="object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBDT(s.price)}</p>
                    </div>
                  </Link>
                ))}
                <button
                  onClick={() => doSearch()}
                  className="flex w-full items-center justify-center gap-1.5 bg-muted/40 p-2.5 text-sm font-medium text-brand-700 hover:bg-muted dark:text-brand-600"
                >
                  View all results for &quot;{query}&quot; <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileSearch((v) => !v)}
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </Button>

            <Button variant="ghost" size="icon" asChild className="relative" aria-label="Wishlist">
              <Link href="/wishlist">
                <Heart className="h-5 w-5" />
                {wishlist.items.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {wishlist.items.length}
                  </span>
                )}
              </Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => cart.setOpen(true)}
              aria-label={`Cart with ${cart.count()} items`}
            >
              <ShoppingBag className="h-5 w-5" />
              {cart.count() > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {cart.count()}
                </span>
              )}
            </Button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Account menu">
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <p className="text-sm font-semibold">{user.name}</p>
                    <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/account"><User className="mr-2 h-4 w-4" /> My Account</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/orders"><Package className="mr-2 h-4 w-4" /> My Orders</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/wishlist"><Heart className="mr-2 h-4 w-4" /> Wishlist</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/addresses"><Settings2 className="mr-2 h-4 w-4" /> Addresses</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/track-order"><PackageSearch className="mr-2 h-4 w-4" /> Track Order</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
                    <LogOut className="mr-2 h-4 w-4" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="ghost" size="icon" asChild aria-label="Sign in">
                <Link href="/login">
                  <LogIn className="h-5 w-5" />
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Mobile search bar */}
        {mobileSearch && (
          <div className="pb-3 md:hidden">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doSearch();
              }}
              className="relative"
            >
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => onSearchInput(e.target.value)}
                placeholder="Search products…"
                className="h-10 rounded-full pl-10"
                aria-label="Search products"
              />
            </form>
            {showSuggestions && suggestions.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                {suggestions.slice(0, 4).map((s) => (
                  <Link
                    key={s.id}
                    href={`/products/${s.slug}`}
                    onClick={() => {
                      setShowSuggestions(false);
                      setMobileSearch(false);
                    }}
                    className="block border-b border-border/60 p-2.5 text-sm last:border-0 hover:bg-muted/50"
                  >
                    {s.name} · <span className="text-muted-foreground">{formatBDT(s.price)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop category nav */}
      <nav className="hidden border-t border-border/60 lg:block" aria-label="Categories">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 no-scrollbar">
          <Link
            href="/products"
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-100 dark:hover:text-brand-600",
              pathname === "/products" && "bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-600"
            )}
          >
            All Products
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/products?category=${c.slug}`}
              className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-100 dark:hover:text-brand-600"
            >
              {c.name}
            </Link>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          <Link
            href="/track-order"
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-100 dark:hover:text-brand-600"
          >
            Track Order
          </Link>
        </div>
      </nav>
    </header>
  );
}
