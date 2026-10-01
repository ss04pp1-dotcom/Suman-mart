// Role-based access control for the ShopNest admin application.

export const PERMISSIONS = [
  "dashboard.view",
  "products.view",
  "products.manage",
  "orders.view",
  "orders.manage",
  "customers.view",
  "customers.manage",
  "suppliers.view",
  "suppliers.manage",
  "coupons.manage",
  "banners.manage",
  "reviews.moderate",
  "analytics.view",
  "tracking.manage",
  "reports.export",
  "settings.view",
  "settings.manage",
  "team.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SUPPORT" | "MARKETING";

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  ADMIN: [
    "dashboard.view",
    "products.view",
    "products.manage",
    "orders.view",
    "orders.manage",
    "customers.view",
    "customers.manage",
    "suppliers.view",
    "suppliers.manage",
    "coupons.manage",
    "banners.manage",
    "reviews.moderate",
    "analytics.view",
    "tracking.manage",
    "reports.export",
    "settings.view",
    "settings.manage",
  ],
  MANAGER: [
    "dashboard.view",
    "products.view",
    "products.manage",
    "orders.view",
    "orders.manage",
    "customers.view",
    "suppliers.view",
    "suppliers.manage",
    "coupons.manage",
    "banners.manage",
    "reviews.moderate",
    "analytics.view",
    "reports.export",
  ],
  SUPPORT: ["dashboard.view", "orders.view", "orders.manage", "customers.view", "reviews.moderate"],
  MARKETING: [
    "dashboard.view",
    "analytics.view",
    "tracking.manage",
    "reports.export",
    "banners.manage",
    "coupons.manage",
    "reviews.moderate",
    "products.view",
  ],
};

export function hasPermission(
  role: string,
  permission: Permission,
  overrides?: string[] | null
): boolean {
  // Explicit per-admin permission overrides win over the role defaults
  if (overrides && overrides.length > 0) {
    return overrides.includes(permission);
  }
  const perms = ROLE_PERMISSIONS[role as AdminRole];
  return perms ? perms.includes(permission) : false;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SUPPORT: "Support",
  MARKETING: "Marketing",
};
