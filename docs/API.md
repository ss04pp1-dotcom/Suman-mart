# ShopNest API Reference

All responses use the envelope `{ "success": boolean, "data"?: T, "error"?: string }`.
Money values are integers in BDT taka. Dates are ISO-8601.

---

## Customer API

### Products
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List. Query: `q, category, tag, minPrice, maxPrice, availability, featured, sort (featured\|newest\|price_asc\|price_desc\|best_selling\|rating\|discount), page, limit` |
| GET | `/api/products/[slug]` | Detail incl. variants, specs, approved reviews, `related` (You May Also Like), `frequentlyBoughtTogether` |
| GET | `/api/categories` | Active categories with product counts |

### Auth
| Method | Path | Body |
|--------|------|------|
| POST | `/api/auth/register` | `{ name, email, phone (01XXXXXXXXX), password (min 8) }` → creates account + sends verification email |
| POST | `/api/auth/login` | `{ email, password }` → sets `sn_session` cookie |
| POST | `/api/auth/logout` | — |
| GET | `/api/auth/me` | → current customer or `null` |
| POST | `/api/auth/forgot` | `{ email }` → always 200 (no account enumeration); mails a one-time reset link |
| POST | `/api/auth/reset` | `{ token, password (min 8) }` → resets password, revokes all sessions |
| POST | `/api/auth/verify-email` | `{ token }` → marks the email verified |
| PUT | `/api/auth/verify-email` | → resend verification email (signed-in customer) |

### Tracking (signed sessions)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/tracking/session` | Issues the signed first-party session (`sn_sk` + `sn_sks` cookies) |
| POST | `/api/tracking/events` | Beacon collector. Payload sessionKey must match the signed cookie pair; **Purchase events are server-only** and dropped here |
| POST | `/api/tracking/consent` | Records the cookie-consent choice (also signature-verified) |

### Cart / Checkout
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/cart/validate` | `{ items: [{productId, variantId?, quantity}], couponCode? }` → server-validated lines, coupon result, totals (shipping rules applied) |
| POST | `/api/checkout/guest-otp` | `{ email }` → emails a one-time 6-digit code proving the guest controls the address. **Active only while a mail provider (RESEND_API_KEY) is configured** (`REQUIRE_GUEST_EMAIL_OTP=0` disables; without a provider it answers 400 OTP_NOT_REQUIRED — no mail can leave the server anyway). Throttled per IP (5/10min) and per email (3/10min). Codes expire in 10 minutes, allow 5 wrong entries, are single-use and SHA-256-hashed at rest. |
| POST | `/api/checkout` | `{ items, address {fullName, phone, line1, line2?, city, area?, postalCode?}, paymentMethod: COD\|BKASH\|NAGAD\|CARD, couponCode?, customerNote?, customerEmail? (required for guests), guestEmailOtp? (required for guests while the OTP policy is active), paymentTrxId? (required for BKASH/NAGAD, globally unique — a repeat is rejected 409; reserved prefixes `COD-`/`MANUAL-`/`REFUND-` and released `-RELEASED-` IDs are rejected) }` → atomic transaction (stock guard + order-number counter + coupon guard), places supplier orders **in the background**, records **server Purchase event** (`purchase_SNxxxxxx`). COD orders include the `codCharge` setting. Signed-in checkout never gates on email verification; guests verify their email with the one-time code only while a mail provider is configured. |

### Orders
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/orders/track` | `{ orderNumber, phone }` — both must match. → order + timeline + courier/tracking |
| GET | `/api/account/orders` | Auth. Paginated order history |
| GET/PUT | `/api/account/profile` | Profile; PUT supports `{ name?, phone?, currentPassword?, newPassword? }` |
| GET/POST | `/api/account/addresses` | Address book (create sets default if first) |
| PUT/DELETE | `/api/account/addresses/[id]` | Owned-address guard |

### Reviews / Tracking / Settings
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/reviews` | `{ productId, rating 1-5, title?, comment, authorName? }` → status PENDING |
| POST | `/api/tracking/events` | `{ session {sessionKey, utm*, referrer, landingPath}, events: [{eventId, name, url, productId?, value?, searchQuery?, searchResults?}] }` — consent-gated by client, dedup on `(eventId, source)` |
| POST | `/api/tracking/consent` | `{ sessionKey, choice: ACCEPT_ALL\|ESSENTIAL_ONLY\|CUSTOM\|REJECTED, analytics?, marketing? }` |
| GET | `/api/settings/public` | Public store config + **public pixel IDs only** (secrets never included) |

---

## Admin API (`/api/admin/*`)
Auth via `sn_admin` cookie. Each route requires a permission (see `lib/permissions.ts`). All mutations are origin-checked and audit-logged.

### Admin auth (`/api/admin/auth/*`)
| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/login` | `{ email, password, totpCode?, recoveryCode? }` — when 2FA is enabled a 6-digit `totpCode` OR a one-time `recoveryCode` (`XXXX-XXXX-XXXX-XXXX`) is required |
| POST | `/auth/totp` | `{ action: setup\|enable\|disable\|regenerate-recovery, code? }` — `enable` and `regenerate-recovery` return 8 one-time recovery codes exactly once; `regenerate-recovery` accepts a current TOTP code or an unused recovery code |
| GET | `/auth/me` | Current admin incl. `totpEnabled` and `recoveryCodesRemaining` |
| POST | `/auth/logout` · PUT `/auth/password` | Session / password management (change revokes other sessions) |

### Permission-guarded routes
| Method | Path | Permission |
|--------|------|-----------|
| GET | `/dashboard?range=` | dashboard.view |
| GET/POST | `/products` · GET/PUT/DELETE `/products/[id]` · POST `/products/bulk` | products.view / products.manage |
| GET | `/orders` · GET/PUT `/orders/[id]` | orders.view / orders.manage. PUT accepts `status`, `paymentStatus`, `trackingNumber`, `courier`, `internalNotes`, `note`, and `smsVerified` — **marking a bKash/Nagad payment PAID requires `smsVerified: true`** (staff confirmed the expected amount + TrxID against the merchant SMS; 422 SMS_MATCH_REQUIRED otherwise). Cancelling/returning an order releases its still-unverified TrxID (renamed `<TRXID>-RELEASED-<orderNumber>`) so the buyer can reuse the real transfer on a replacement order; verified (SUCCESS) references stay locked. |
| GET | `/customers` · GET `/customers/[id]` | customers.view |
| GET/POST/PUT/DELETE | `/categories`, `/coupons`, `/banners`, `/reviews` | respective manage |
| GET/POST/PUT/DELETE | `/suppliers` · GET `/suppliers/[id]` | suppliers.view / suppliers.manage |
| POST | `/suppliers/[id]/sync` `{type: PRODUCTS\|PRICES\|STOCK}` | suppliers.manage |
| POST | `/suppliers/products/import` `{supplierId, supplierProductId}` | suppliers.manage |
| POST | `/suppliers/orders/[id]` `{action: refresh\|cancel}` | suppliers.manage |
| GET | `/analytics/{overview,funnel,campaigns,products,searches,consent,abandoned,live}` | analytics.view |
| GET | `/analytics/events` (+filters) · GET `/analytics/events/[id]` (inspector + dedup view) | analytics.view |
| GET/PUT | `/settings?key=general\|payment\|shipping\|orders\|seo\|notifications\|tracking` | settings.view / settings.manage |
| POST | `/settings/test-integration` `{provider}` | tracking.manage |
| GET/PUT | `/notifications` | dashboard.view |
| POST | `/upload` (multipart `file`, `folder`) | products.manage |
| GET | `/reports/export?type=sales\|orders\|products\|customers\|suppliers\|campaigns\|traffic\|conversion\|events&range=` | reports.export → CSV |
| GET/POST/PUT | `/team` | team.manage |

### Range parameter
`?range=today|yesterday|7d|30d|month` or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`

---

## Tracking event names
`PageView, ViewContent, Search, AddToCart, ViewCart, InitiateCheckout, AddPaymentInfo, Purchase, AddToWishlist, SignUp, Login, Lead`

**Deduplication:** the browser and the server emit the same logical event with a shared `eventId` (e.g. `purchase_SN100331`). Analytics count DISTINCT eventIds; the Event Inspector shows `Browser: Received / Server: Received / Deduplication: Applied`.

## Cookie consent model
- Essential-only → no analytics, no pixels
- Analytics → first-party events collected
- Marketing → third-party pixels load and receive browser copies; server events forward to Meta CAPI / GA4 MP / TikTok Events API only with marketing consent

## Direct API access (`/v1/*` — Cloudflare Workers, api.example.com)

The Workers API serves EVERYTHING — the public surface below, all customer
and admin endpoints from the sections above (same paths under `/v1`), the
RSC data bundles, R2 media, and the hourly scheduled jobs. All responses
carry `X-API-Version: v1`, baseline security headers, and
`Cache-Control: no-store` (media excepted). Cross-origin browser use is
governed by `ALLOWED_ORIGINS` (fail-closed default; preflight `OPTIONS`
answered on every route) — the storefront/admin proxies need no entry
because they call same-origin.

### GET /health
`200 {status:"ok", checks:{database:"ok"}, environment, time}` — `503 degraded`
when the D1 binding cannot answer.

### GET /v1/products
Query parameters (zod-validated → `422 {code:"VALIDATION_ERROR"}` on bad input):

| Param | Type | Notes |
|---|---|---|
| `q` | string | matches name / shortDescription / brand (ASCII case-insensitive) |
| `category` | slug | category filter |
| `tag` | slug | tag filter |
| `minPrice` / `maxPrice` | int | **combine** into one range |
| `availability` | `in_stock` \| `out_of_stock` | |
| `featured` | `true` | |
| `sort` | `featured` (default) \| `newest` \| `price_asc` \| `price_desc` \| `best_selling` \| `rating` \| `discount` | |
| `page` / `limit` | int | limit capped at 60, default 12 |

Response: `{items:[…], total, page, limit, totalPages, tags:[facets]}` — each
item carries `imageUrl` / `hoverImageUrl` (first two gallery images).

### GET /v1/products/:slug
Full public detail — `404 {code:"NOT_FOUND"}` for unknown or INACTIVE slugs.
Includes images, `variants` (parsed `options` object), APPROVED reviews only
(latest 20), `related` (manual relations first, then auto-fill from the same
category / shared tags by soldCount, max 8) and `frequentlyBoughtTogether`.
Supplier `costPrice` is deliberately not part of the public contract.

### GET /v1/categories
Active categories ordered by `sortOrder` with `productCount` (active products only).

### GET /v1/settings/public
Public-safe settings: store identity, payment methods (card always `false`),
shipping rules, browser pixel IDs (enabled integrations only). Secrets are
never part of the response.

### POST /v1/orders/track
`{ "orderNumber": "SN100001", "phone": "017…" }` — both required (`422`
otherwise). The order number is case-insensitive; the phone matches on the
last 10 digits. Wrong phone and unknown order number return the SAME
`404` message (no enumeration). Rate limited: 20 requests / 10 min per IP →
`429 {code:"RATE_LIMITED"}`.

### GET /v1/media/:key
R2 object stream with `Content-Type` (by extension / object metadata) and
`Cache-Control: public, max-age=31536000, immutable`. `404` envelope when
missing; traversal keys rejected.

### Errors
`{ "success": false, "error": "…", "code": "NOT_FOUND" | "VALIDATION_ERROR" | "RATE_LIMITED" | "INTERNAL" }`
with the appropriate HTTP status. Stack traces never leave the server
(structured console logs carry method/path/message instead).
