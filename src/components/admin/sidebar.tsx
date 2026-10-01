"use client";

/**
 * Admin sidebar navigation — dark professional theme, role-aware.
 * Marketing role sees analytics; Support sees orders; etc. (see lib/permissions)
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, Boxes, ChevronLeft, FileBarChart, LayoutDashboard, LogOut,
  Megaphone, Package, PackageSearch, ScrollText, Settings, ShieldCheck, ShoppingCart,
  Star, Store, Ticket, Truck, Users, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type AdminInfo } from "./admin-shell";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", href: "/admin", icon: LayoutDashboard, permission: "dashboard.view" }],
  },
  {
    title: "Catalog",
    items: [
      { label: "Products", href: "/admin/products", icon: Package, permission: "products.view" },
      { label: "Categories", href: "/admin/categories", icon: Boxes, permission: "products.view" },
      { label: "Reviews", href: "/admin/reviews", icon: Star, permission: "reviews.moderate" },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Orders", href: "/admin/orders", icon: ShoppingCart, permission: "orders.view" },
      { label: "Customers", href: "/admin/customers", icon: Users, permission: "customers.view" },
      { label: "Coupons", href: "/admin/coupons", icon: Ticket, permission: "coupons.manage" },
    ],
  },
  {
    title: "Supply",
    items: [
      { label: "Suppliers", href: "/admin/suppliers", icon: Truck, permission: "suppliers.view" },
      { label: "Banners", href: "/admin/banners", icon: Megaphone, permission: "banners.manage" },
    ],
  },
  {
    title: "Analytics & Tracking",
    items: [
      { label: "Overview", href: "/admin/analytics", icon: BarChart3, permission: "analytics.view" },
      { label: "Tracking & Pixels", href: "/admin/analytics/tracking", icon: Activity, permission: "analytics.view" },
      { label: "Event Logs", href: "/admin/analytics/events", icon: ScrollText, permission: "analytics.view" },
      { label: "Campaigns", href: "/admin/analytics/campaigns", icon: Megaphone, permission: "analytics.view" },
      { label: "Reports", href: "/admin/analytics/reports", icon: FileBarChart, permission: "analytics.view" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Settings", href: "/admin/settings", icon: Settings, permission: "settings.view" },
      { label: "Security", href: "/admin/security", icon: ShieldCheck },
    ],
  },
];

export function AdminSidebar({
  admin,
  collapsed,
  onToggle,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: {
  admin: AdminInfo;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();

  const can = (permission?: string) => !permission || admin.permissions.includes(permission);

  const nav = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4", collapsed && "lg:justify-center lg:px-2")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-brand text-white shadow-lg">
          <Store className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="hidden lg:block">
            <p className="text-sm font-extrabold leading-tight text-white">ShopNest</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Admin Console</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto py-4 px-3 refined-scroll" aria-label="Admin navigation">
        {NAV_SECTIONS.map((section) => {
          const visible = section.items.filter((i) => can(i.permission));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                          active
                            ? "bg-emerald-500/15 text-emerald-300 shadow-inner"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                          collapsed && "lg:justify-center lg:px-2"
                        )}
                      >
                        <item.icon className={cn("h-4.5 w-4.5 shrink-0", active && "text-emerald-300")} />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {!collapsed && active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5", collapsed && "lg:justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-xs font-bold text-emerald-300">
            {admin.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-200">{admin.name}</p>
                <p className="truncate text-[10px] text-slate-500">{admin.roleLabel}</p>
              </div>
              <button
                onClick={onLogout}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-rose-400"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <button
          onClick={onToggle}
          className="mt-2 hidden w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300 lg:flex"
        >
          <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && "Collapse"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-all lg:block",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar shadow-2xl">{nav}</aside>
        </div>
      )}
    </>
  );
}

export { Bell, ShieldCheck, PackageSearch };
