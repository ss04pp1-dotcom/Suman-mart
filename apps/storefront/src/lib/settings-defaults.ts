// Pure default settings + typed shapes (NO database imports — safe for UI
// bundles and edge contexts). lib/settings re-exports these for backwards
// compatibility; the storefront's server settings reads now go through the
// Workers API (lib/backend-proxy.ts).

export interface GeneralSettings {
  storeName: string;
  tagline: string;
  supportPhone: string;
  supportEmail: string;
  address: string;
  facebookUrl: string;
  instagramUrl: string;
}

export interface PaymentSettings {
  codEnabled: boolean;
  bkashEnabled: boolean;
  bkashNumber: string;
  nagadEnabled: boolean;
  nagadNumber: string;
  cardEnabled: boolean;
}

export interface ShippingSettings {
  flatRate: number;
  freeShippingThreshold: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  codCharge: number;
}

export interface OrderSettings {
  defaultLowStockThreshold: number;
  allowGuestCheckout: boolean;
  autoConfirmOrders: boolean;
  orderNote: string;
}

export interface SeoSettings {
  defaultTitle: string;
  defaultDescription: string;
  keywords: string;
}

export interface NotificationSettings {
  newOrderAlerts: boolean;
  lowStockAlerts: boolean;
  syncFailureAlerts: boolean;
  reviewAlerts: boolean;
  trackingErrorAlerts: boolean;
}

export const DEFAULT_SETTINGS = {
  general: {
    storeName: "ShopNest",
    tagline: "Everything you love, delivered to your nest",
    supportPhone: "+880 1700-000000",
    supportEmail: "support@shopnest.com.bd",
    address: "House 12, Road 5, Dhanmondi, Dhaka 1205",
    facebookUrl: "https://facebook.com/shopnest",
    instagramUrl: "https://instagram.com/shopnest",
  } satisfies GeneralSettings,
  payment: {
    codEnabled: true,
    bkashEnabled: false,
    bkashNumber: "",
    nagadEnabled: false,
    nagadNumber: "",
    cardEnabled: false,
  } satisfies PaymentSettings,
  shipping: {
    flatRate: 60,
    freeShippingThreshold: 2000,
    estimatedDaysMin: 2,
    estimatedDaysMax: 5,
    codCharge: 0,
  } satisfies ShippingSettings,
  orders: {
    defaultLowStockThreshold: 5,
    allowGuestCheckout: true,
    autoConfirmOrders: false,
    orderNote: "Thank you for shopping with ShopNest!",
  } satisfies OrderSettings,
  seo: {
    // Brand-free on purpose: the layout template appends "| <Store>" exactly once.
    defaultTitle: "Online Shopping in Bangladesh — Everything You Love, Delivered",
    defaultDescription:
      "Shop electronics, fashion, home essentials and more with fast delivery across Bangladesh. Cash on delivery available.",
    keywords: "shopnest, online shopping, bangladesh, electronics, fashion",
  } satisfies SeoSettings,
  notifications: {
    newOrderAlerts: true,
    lowStockAlerts: true,
    syncFailureAlerts: true,
    reviewAlerts: true,
    trackingErrorAlerts: true,
  } satisfies NotificationSettings,
} as const;

export type SettingsKey = keyof typeof DEFAULT_SETTINGS;
