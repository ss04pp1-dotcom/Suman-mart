import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().min(2, "Name is too short").max(80),
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .regex(/^01[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number (01XXXXXXXXX)"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Cart / checkout ───────────────────────────────────────────────

export const cartItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(20),
});

export const addressSchema = z.object({
  fullName: z.string().min(2, "Full name is required").max(80),
  phone: z.string().regex(/^01[3-9]\d{8}$/, "Enter a valid mobile number (01XXXXXXXXX)"),
  line1: z.string().min(4, "Address line is required").max(160),
  line2: z.string().max(160).optional().nullable(),
  city: z.string().min(2, "City is required").max(60),
  area: z.string().max(60).optional().nullable(),
  postalCode: z.string().max(10).optional().nullable(),
});

export const checkoutSchema = z
  .object({
    items: z.array(cartItemSchema).min(1, "Your cart is empty").max(50, "Too many items in one order"),
    couponCode: z.string().max(40).optional().nullable(),
    address: addressSchema,
    customerNote: z.string().max(500).optional().nullable(),
    paymentMethod: z.enum(["COD", "BKASH", "NAGAD", "CARD"]),
    // Guest contact email (required for guests — order confirmation mail)
    customerEmail: z.string().email("Enter a valid email for your order confirmation").optional().nullable(),
    // One-time email verification code for guests (required only while a mail
    // provider is configured — see src/lib/email-gate.ts, round-4 audit)
    guestEmailOtp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email").optional().nullable(),
    // bKash/Nagad manual-payment transaction reference
    paymentTrxId: z.string().regex(/^[A-Za-z0-9-]{6,40}$/, "Enter the transaction ID from your payment SMS (e.g. 9F7HD2K1LM)").optional().nullable(),
  })
  // Manual mobile payments must carry a transaction reference
  .refine((v) => !(v.paymentMethod === "BKASH" || v.paymentMethod === "NAGAD") || v.paymentTrxId, {
    message: "Enter the bKash/Nagad transaction ID after sending the payment",
    path: ["paymentTrxId"],
  });

export const reviewSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional().nullable(),
  comment: z.string().min(10, "Review must be at least 10 characters").max(2000),
  authorName: z.string().min(2).max(60).optional(),
});

// ── Admin ─────────────────────────────────────────────────────────

export const productSchema = z.object({
  name: z.string().min(3).max(160),
  slug: z.string().min(3).max(180).optional(),
  shortDescription: z.string().max(300).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  price: z.number().int().min(0),
  compareAtPrice: z.number().int().min(0).optional().nullable(),
  costPrice: z.number().int().min(0).optional().nullable(),
  sku: z.string().min(1).max(60),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  brand: z.string().max(60).optional().nullable(),
  categoryId: z.string().min(1),
  specifications: z
    .array(z.object({ group: z.string().max(60), key: z.string().max(60), value: z.string().max(200) }))
    .optional(),
  seoTitle: z.string().max(180).optional().nullable(),
  seoDescription: z.string().max(400).optional().nullable(),
  images: z.array(z.object({ url: z.string().min(1), alt: z.string().optional().nullable() })).optional(),
  tags: z.array(z.string().max(40)).optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        options: z.record(z.string(), z.string()),
        sku: z.string().max(60).optional().nullable(),
        price: z.number().int().min(0).optional().nullable(),
        stock: z.number().int().min(0).optional(),
      })
    )
    .optional(),
  relatedProductIds: z.array(z.string()).optional(),
  fbtProductIds: z.array(z.string()).optional(),
});

export const couponSchema = z.object({
  code: z.string().min(3).max(40).transform((s) => s.toUpperCase().trim()),
  type: z.enum(["PERCENTAGE", "FIXED", "FREE_SHIPPING"]),
  value: z.number().int().min(0).optional(),
  minOrderAmount: z.number().int().min(0).optional().nullable(),
  maxDiscount: z.number().int().min(0).optional().nullable(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional().nullable(),
  usageLimit: z.number().int().min(0).optional().nullable(),
  perCustomerLimit: z.number().int().min(0).optional().nullable(),
  productId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const bannerSchema = z.object({
  title: z.string().min(2).max(120),
  subtitle: z.string().max(200).optional().nullable(),
  imageUrl: z.string().min(1),
  buttonLabel: z.string().max(40).optional().nullable(),
  buttonUrl: z.string().max(300).optional().nullable(),
  placement: z.enum(["HERO", "PROMO"]),
  theme: z.enum(["Dark", "Light"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const supplierSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(30).transform((s) => s.toUpperCase().trim()),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  adapter: z.string().min(2).max(60),
  baseUrl: z.string().max(300).optional().nullable(),
  apiKey: z.string().max(300).optional().nullable(),
  apiSecret: z.string().max(300).optional().nullable(),
  autoSyncPrice: z.boolean().optional(),
  autoSyncStock: z.boolean().optional(),
  markupPercent: z.number().int().min(0).max(500).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export const categorySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const trackingEventSchema = z.object({
  session: z.object({
    sessionKey: z.string().min(8).max(64),
    utmSource: z.string().max(120).optional().nullable(),
    utmMedium: z.string().max(120).optional().nullable(),
    utmCampaign: z.string().max(200).optional().nullable(),
    utmContent: z.string().max(200).optional().nullable(),
    utmTerm: z.string().max(200).optional().nullable(),
    referrer: z.string().max(500).optional().nullable(),
    landingPath: z.string().max(300).optional().nullable(),
  }),
  events: z
    .array(
      z.object({
        eventId: z.string().min(6).max(100),
        name: z.enum([
          "PageView",
          "ViewContent",
          "Search",
          "AddToCart",
          "ViewCart",
          "InitiateCheckout",
          "AddPaymentInfo",
          "Purchase",
          "AddToWishlist",
          "SignUp",
          "Login",
          "Lead",
        ]),
        url: z.string().max(300).optional().nullable(),
        productId: z.string().max(40).optional().nullable(),
        productName: z.string().max(200).optional().nullable(),
        searchQuery: z.string().max(200).optional().nullable(),
        searchResults: z.number().int().min(0).max(10000).optional().nullable(),
        value: z.number().min(0).optional().nullable(),
        quantity: z.number().int().min(1).max(100).optional().nullable(),
      })
    )
    .max(25),
});

export const consentSchema = z.object({
  sessionKey: z.string().min(8).max(64),
  choice: z.enum(["ACCEPT_ALL", "ESSENTIAL_ONLY", "CUSTOM", "REJECTED"]),
  analytics: z.boolean().optional(),
  marketing: z.boolean().optional(),
});
