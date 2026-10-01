"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminSidebar, NAV_SECTIONS } from "./sidebar";
import { Menu, Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface AdminInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  permissions: string[];
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

function titleForPath(pathname: string): { title: string; section: string } {
  // Collect ALL prefix matches, then use the longest (most specific) href —
  // e.g. "/admin/analytics/tracking" must beat its parent "/admin/analytics",
  // otherwise the header title degrades to the raw URL segment ("tracking").
  let best: { href: string; label: string; section: string } | null = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const matches = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
      if (matches && (!best || item.href.length > best.href.length)) {
        best = { href: item.href, label: item.label, section: section.title };
      }
    }
  }
  if (best) {
    const rest = pathname.slice(best.href.length).replace(/^\//, "");
    if (rest) {
      if (rest === "new") return { title: "New", section: best.section };
      // ID-like / long segments are detail pages (order/product/customer ids)
      return { title: rest.length > 12 ? "Details" : decodeURIComponent(rest), section: best.section };
    }
    return { title: best.label, section: best.section };
  }
  return { title: "Admin", section: "ShopNest" };
}

function NotificationsBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = () => {
    fetch("/api/admin/notifications")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setNotifications(d.data.notifications);
          setUnread(d.data.unread);
        }
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  const markAll = async () => {
    await fetch("/api/admin/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
    load();
  };

  const typeColors: Record<string, string> = {
    ORDER: "bg-emerald-500",
    PAYMENT: "bg-sky-500",
    STOCK: "bg-amber-500",
    SUPPLIER: "bg-violet-500",
    TRACKING: "bg-rose-500",
    REVIEW: "bg-pink-500",
    SYSTEM: "bg-slate-500",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-slate-300 hover:text-white" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-bold">Notifications</p>
          {unread > 0 && (
            <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-600">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto refined-scroll">
          {notifications.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No notifications yet</p>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "/admin"}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex gap-3 border-b border-border/60 p-4 last:border-0 hover:bg-muted/50",
                  !n.isRead && "bg-brand-50/50 dark:bg-brand-100/10"
                )}
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", typeColors[n.type] ?? "bg-slate-400")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.isRead && <Badge className="h-fit bg-brand-600 hover:bg-brand-600">New</Badge>}
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AdminShell({ admin, children }: { admin: AdminInfo; children: React.ReactNode }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { title, section } = titleForPath(pathname);

  // Keep the browser tab in sync with the current admin section (the shell is
  // a client component, so static metadata alone can't reflect the route).
  // On hard loads React's hoisted-metadata reconciliation can restore the SSR
  // <title> right after this effect runs — the MutationObserver re-asserts the
  // section title whenever anything else rewrites it.
  useEffect(() => {
    const wanted = `${title} | ShopNest Console`;
    document.title = wanted;
    const el = document.querySelector("title");
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (document.title !== wanted) document.title = wanted;
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [title]);

  const logout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" }).catch(() => undefined);
    toast.success("Signed out");
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-slate-100/80 dark:bg-slate-950">
      <AdminSidebar
        admin={admin}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onLogout={logout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={cn("flex min-h-screen flex-col transition-all", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-sidebar-border bg-sidebar/95 px-4 backdrop-blur sm:px-6">
          <button
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{section}</p>
            <h1 className="truncate text-lg font-bold leading-tight text-white">{title}</h1>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10 sm:inline-flex">
              ● Live
            </Badge>
            <NotificationsBell />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function AdminQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
