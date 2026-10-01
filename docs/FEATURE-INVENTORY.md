# ShopNest / Suman Mart — Feature Inventory & Migration Tracker

> Phase-1 audit deliverable, kept current through the completed Cloudflare migration.
> Every feature below is **verified working** on the production build unless marked
> otherwise. The migration to the target architecture (storefront / Workers API /
> admin as independently deployable apps on D1 + R2) is **COMPLETE** — see §8.

Status legend: ✅ working & verified · 🔶 working with documented limitation · ⏳ migration
pending (target architecture) · 🚫 externally blocked (credentials/docs needed)

---

## 1. Current architecture (before this phase)

Single Next.js 16 App-Router application (standalone output), Prisma + SQLite main DB
(`db/custom.db`) plus a dedicated rate-limit SQLite DB, file uploads to `upload/`
(R2-ready storage abstraction), 42 pages + 62 API route files, 33 Prisma models.
Verified state at audit time: `tsc` clean, ESLint 0 errors, **93/93 tests green**,
production build green (`ignoreBuildErrors: false`).

## 2. Storefront features (all preserved)

| Feature | Where | Status | Migration to target arch |
|---|---|---|---|
| Homepage: hero carousel, category grid, featured / offers / new / best-sellers, reviews wall, why-us, shipping strip | `(shop)/page.tsx` | ✅ | stays in storefront app |
| Product listing: category + tag + price + rating filters, 5 sorts, pagination, URL state | `(shop)/products/page.tsx` | ✅ | API `/v1/products` ported |
| Product detail: gallery, variants w/ stock, FBT bundle, related, reviews + JSON-LD, breadcrumbs | `(shop)/products/[slug]/page.tsx` | ✅ | API `/v1/products/:slug` ported |
| Cart: page + drawer, quantity/stock validation, persistent (zustand) | `cart/page.tsx`, `cart-drawer.tsx` | ✅ | stays client-side; validation API ported later |
| 3-step checkout: contact (guest email **optional** + OTP when provided), address, payment (COD / bKash / Nagad manual TrxID; card hard-disabled) | `checkout/page.tsx` | ✅ | write-path stays on Node until D1 tx port (see §7) |
| Guest email OTP: 6-digit, hashed at rest, atomic single-use claim, per-IP 5/10m, per-email 3/10m + **daily cap 10/24h**, provider-outage auto-relax | `api/checkout/guest-otp` | ✅ | ported later with checkout |
| Coupons: server-side validation, per-customer limits incl. guest email/phone identity | `lib/checkout.ts` | ✅ | ported later |
| Order success + receipt + server Purchase event (deduped) | `order-success/[orderNumber]` | ✅ | ported later |
| Guest order tracking by orderNumber + phone/email | `track-order/page.tsx` | ✅ | API `/v1/orders/track` ported |
| Auth: register/login/logout, email verify, forgot/reset (single-use hashed tokens), tokenVersion session revoke | `(shop)/login|register|verify-email|forgot|reset` | ✅ | ported later |
| Account: profile, addresses CRUD, orders list + detail, wishlist, security (password change) | `(shop)/account/**` | ✅ | ported later |
| Wishlist (zustand persist, guest→account merge on login) | `wishlist/page.tsx` | ✅ | stays client-side |
| Cookie consent (Essential/Analytics/Marketing, persisted, withdrawable) | `consent-banner.tsx` | ✅ | stays client-side |
| SEO: sitemap, robots, canonical, OG, JSON-LD product schema | `app/sitemap.ts`, `robots.ts` | ✅ | stays |
| 404, loading/empty states, mobile-first responsive (390px verified) | app-wide | ✅ | stays |

## 3. Admin console features (all preserved)

| Feature | Where | Status |
|---|---|---|
| Standalone login: PBKDF2 600k, per-email + IP lockouts, TOTP 2FA (encrypted at rest, replay-protected), recovery codes, must-change-password gate | `admin/login`, `admin/security`, `admin/change-password` | ✅ |
| Dashboard: 12 KPIs, traffic + revenue + orders charts, top products, low stock, recent orders | `admin/(shell)/page.tsx` | ✅ |
| Products: filters, bulk ops (activate/feature/archive), duplicate, 7-tab editor (general/pricing/images/variants/specs/SEO/relations), image upload (magic-byte + sharp re-encode, SVG banned) | `admin/products/**` | ✅ |
| Orders: filters + detail; status flow validation; payment verification block (expected amount + TrxID + **server-enforced SMS-match tick**, audited); cancel/return restores stock exactly-once; cancel releases unverified TrxID, verified stays locked | `admin/orders/**` | ✅ |
| Customers: list + detail (history, deactivate/reactivate w/ session revoke) | `admin/customers/**` | ✅ |
| Categories, Coupons, Banners + homepage sections, Review moderation (approve/reject/feature/reply, verified-purchase badge) | respective pages | ✅ |
| Suppliers: list + detail, sync (products/prices/stock), import w/ markup, supplier orders w/ attempts/lastError + retry | `admin/suppliers/**` | ✅ (demo adapter only — see §5) |
| Analytics: overview KPIs, funnel, sources, devices/geo, products, campaigns (UTM), searches, abandoned carts, live activity, consent stats, event logs + inspector w/ dedup diagnostics, pixel health | `admin/analytics/**` | ✅ |
| Reports: 9 CSV exports (formula-injection neutralized) | `admin/analytics/reports` | ✅ |
| Settings: store, payments (manual only), shipping, SEO, tracking pixels (Meta/GA4/GT/GAds/TikTok + CAPI/MP/Events API), team mgmt (5 roles + permission overrides), maintenance (retention + supplier retries) | `admin/settings` | ✅ |
| Audit logs for sensitive actions incl. `payment.sms_verified` w/ operator identity | `lib/audit.ts` | ✅ |

## 4. API surface (62 route files → grouped)

- **Public catalog**: products list/detail, categories, settings/public, reviews
- **Auth**: register/login/logout/me/verify-email/forgot/reset (customer) + admin auth (login/logout/me/password/totp)
- **Account**: profile, addresses CRUD, orders
- **Commerce**: checkout, checkout/guest-otp, cart/validate, orders/track
- **Tracking**: session (HMAC), events (ingestion, dedup, quotas), consent
- **Admin**: dashboard, products (+bulk, [id]), categories, orders (+[id]), customers (+[id]), coupons, banners, reviews, suppliers (+[id]/sync/import/orders), analytics (overview/funnel/campaigns/products/events/events[id]/searches/abandoned/live/consent), reports/export, settings (+test-integration), team, upload, maintenance, notifications

## 5. Integrations (all server-side logic lives in apps/api)

| Integration | Status | Notes |
|---|---|---|
| Resend email (confirmations, OTP, reset, outbox w/ redaction) | ✅ optional (`RESEND_API_KEY`); outbox always records | outage breaker auto-relaxes guest OTP |
| Meta Pixel + Conversions API | ✅ code complete | needs real pixel ID + CAPI token (🚫 creds) |
| GA4 + Measurement Protocol, GTM, Google Ads | ✅ code complete | needs IDs (🚫 creds) |
| TikTok Pixel + Events API | ✅ code complete | needs creds (🚫) |
| bKash / Nagad | ✅ manual verification flow | merchant number from settings; automated gateway needs merchant API creds (🚫) |
| Card payments | ✅ hard-disabled by design |  |
| Supplier dropshipping | 🔶 demo adapter only | real adapter blocked on supplier API docs/credentials (🚫); interface + sync engine + import + orders + retries all real |
| Storage | ✅ R2-backed (read + write) | `/v1/media/*` serves the bucket; `/v1/admin/upload` writes it (magic-byte validation; SVG banned; no sharp re-encode on Workers — documented) |

## 6. Security (verified by tests/E2E across rounds 1–5 + the D1 port)

PBKDF2 600k + transparent legacy upgrade · JWT (Web Crypto, edge-safe) w/ tokenVersion
revocation · RBAC (5 roles + per-admin overrides, server-enforced) · **rate limiting on
D1 (shared across every Worker instance) w/ in-memory fail-degraded fallback** · nonce
CSP (no unsafe-inline/eval) · SSRF guard on outbound fetches · upload magic-byte
validation (SVG banned) · CSV injection neutralization · HMAC tracking sessions +
(eventId,source) dedup + quotas · zod validation everywhere · audit logs · non-atomic →
atomic fixes for stock/coupon/order-number/TrxID/OTP-attempts — re-proven on D1:
8-way parallel race → exactly-5-sold, cancel → exactly-once restore.

## 7. Known limitations (updated for the target architecture)

All storefront pages force-dynamic (nonce CSP trade-off) · fixed-window rate limits allow
~2× boundary burst · supplier demo adapter (engine real, adapter demo) · guest coupon
limit rotatable by email/phone change · no sharp re-encode on Workers (uploads stored
byte-exact after validation) · single D1 primary (see README → Known limitations).
**The single-instance SQLite + file rate-limit limitations are GONE** — data, locks and
rate limiting now live in D1, and both UI tiers are stateless.

---

## 8. Migration tracker — target architecture

Target: **apps/storefront** (Next.js, shop.*) + **apps/api** (Cloudflare Workers, api.*,
versioned REST, D1 + R2) + **apps/admin** (Next.js, admin.*) + **packages/shared**
(contracts). Strangler pattern: nothing is deleted until its replacement is verified.

| Phase | Work | Status |
|---|---|---|
| 1 | Audit + this inventory | ✅ done |
| 2 | Monorepo workspace; monolith → `apps/storefront` (unchanged behavior, root dev server keeps port 3000) | ✅ done — 93 tests/tsc/build green after the move, git-rename history preserved |
| 3 | `apps/api` Workers: Hono + Zod, `/v1` public endpoints (health, products, product detail, categories, settings, order tracking), CORS, security headers | ✅ done — wrangler dev verified |
| 4 | D1 migrations generated from Prisma schema + local D1 tests (vitest-pool-workers); R2 media binding + migration script | ✅ done — 35/35 tests on real local D1+R2 |
| 5 | `packages/shared` contracts | ✅ done — envelope/schemas consumed by apps/api |
| 6 | `apps/admin` extraction (own Next.js app, admin.* deployable) | ✅ done — pure UI + runtime proxy; browser E2E green (login/dashboard/orders/**write persisted**/images 24-24/editor/analytics, 0 console errors) |
| 7 | Storefront strips the admin UI (preserved in apps/admin) | ✅ done — /admin 404s on storefront; admin API kept as the proxy backend; full guest COD journey re-verified (SN100354) |
| 8 | Port ALL write-paths (auth, checkout, tracking ingestion, admin CRUD) from Next.js routes to Workers/D1 — checkout redesigned as ONE atomic D1 batch (guarded INSERT..SELECT..WHERE + conditional updates + sentinel abort), order-flow stock-restore via crypto token, rate limiting → D1, uploads → R2, plus the RSC data bundles (`/v1/storefront/*`) and the hourly scheduled handler | ✅ done — 61 route files ported; Prisma-on-D1 validated in both runtimes; 62/62 tests green at the checkpoint (103 after Phase 9 moved the pure-logic suites over); DateTime epoch→ISO conversion handled by export-to-d1 |
| 9 | Storefront/admin flip to the Workers API | ✅ done — both apps are pure UI + proxy tiers (catch-all `/api/*` → `/v1/*`, RSC `apiGet` bundles, `/v1/media` proxies, admin layout session check via `/v1/admin/auth/me`); dead monolith residue stripped (30 storefront libs, both apps' Prisma stacks, stale env requirements); E2E on the production trio: **journeys 49/49 + round5 38/38**; a real flip bug (account pages not forwarding the session cookie) was found and fixed by the new suite |

**Blockers (external)**: Cloudflare account/creds for real deploy (`wrangler deploy`, D1
remote, R2 remote) — config + local emulation are complete and tested; real supplier API
docs/credentials; real pixel/gateway credentials. Everything else is code-complete and
verified locally; see `docs/VERIFICATION-REPORT.md`.

**Migration tooling (Phase 8 — done)**: `apps/api/scripts/export-to-d1.ts`
(SQLite → FK-ordered D1 INSERT chunks + row-count report; verified against the dev DB —
354 orders / 10,877 tracking events exported), `apps/api/scripts/migrate-media-to-r2.sh`
(dry-run verified: products/banners/categories/uploads → R2 keys). Rollback = D1
time-travel restore; neither tool deletes or mutates source data.
