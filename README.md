# ShopNest — Full-Stack E-Commerce & Dropshipping Platform

A production-grade e-commerce platform delivered as a **monorepo of three independently deployable apps** — a customer **storefront**, an **admin console**, and a versioned **REST API on Cloudflare Workers** (D1 database + R2 media) — sharing one data model, one tracking/analytics engine, and one set of contracts (`packages/shared`).

```
Customer storefront              Admin console                (any client)
  shop.example.com                 admin.example.com
  apps/storefront (Next.js)        apps/admin (Next.js, UI only)
        │                                │  proxies /api/admin/*
        │  serves /api/* (Node API)  ◄──┘  (BACKEND_ORIGIN)
        ▼
  ┌───────────────────────────────────────────────┐
  │  Backend API                                   │
  │  • apps/storefront /api/*  — full write-path   │
  │    (auth, checkout, admin CRUD, tracking)      │
  │  • apps/api (Cloudflare Workers) — /v1 public  │
  │    read API: catalog, settings, order tracking │
  │    → D1 (SQLite) + R2 (media)                  │
  └───────────────────────────────────────────────┘
        │
        ▼
   Tracking & Analytics Engine (first-party, cookie-consent aware)
        │
   ┌────┴─────────┬──────────────┐
   ▼              ▼              ▼
 Meta CAPI    GA4 Measurement  TikTok Events API
 (server-side forwarding, browser+server event-ID dedup)
```

**Migration state (strangler, see `docs/FEATURE-INVENTORY.md §8`)**: the public read
surface is LIVE on the Workers API (`apps/api`, tested against real local D1+R2).
The write-path (auth, checkout, tracking ingestion, admin CRUD) still runs on the
storefront's Node API — the admin app consumes it through a runtime proxy, so when
those endpoints port to Workers, only `BACKEND_ORIGIN` changes. **No feature was
removed or mocked during the split — every page, route and flow was re-verified
end-to-end after the restructure.**

## Quick start

Three tiers, three terminals — the Workers API owns ALL data (local D1 + R2 via
miniflare, no Cloudflare account needed for local dev):

```bash
git clone <repo-url> shopnest && cd shopnest
bun install                     # workspace install (apps/* + packages/*)

# 1. API (terminal 1) — the ONLY tier that touches the database
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill the secrets
bun run db:seed:local           # wrangler migrations + fixtures + admin accounts + R2 images
bun run dev:api                 # http://localhost:8787  (wrangler dev)

# 2. Storefront (terminal 2) — pure UI + proxy → :8787
cp apps/storefront/.env.example apps/storefront/.env   # SESSION_SECRET must MATCH the API's
bun run dev                     # http://localhost:3000

# 3. Admin app (terminal 3) — pure UI + proxy → :8787
cp apps/admin/.env.example apps/admin/.env             # ADMIN_SESSION_SECRET must MATCH the API's
bun run dev:admin               # http://localhost:3001
```

`bun run test` runs the API suite (103 tests, real local D1 + R2 under
workerd) and the storefront unit suite; see **QA** below for the E2E drivers.

### Seeded credentials (LOCAL DEV ONLY — never production)

`bun run db:seed:local` (`apps/api/scripts/dev-seed.mjs`) creates:

| Account | Password | Role |
|---|---|---|
| `admin@shopnest.com` | `Admin123!SuperSecure` | SUPER_ADMIN |
| `support@shopnest.com` | `Support123!Pass` | SUPPORT (limited) |

The seeded catalogue carries products, categories, a demo supplier, banners,
homepage sections, the `WELCOME10` coupon and product images in local R2 —
enough to exercise every dashboard. Demo coupons: `WELCOME10` (10% ≤ ৳300).

## Environment variables

Each tier owns only what it needs — **the API owns every secret**; the UI tiers
keep only the edge-guard keys (which must MATCH the API's values, or sessions
deadlock in a login loop):

| Tier | Variable | Notes |
|---|---|---|
| **apps/api** (wrangler) | `SESSION_SECRET` | customer JWT + tracking HMAC signing — openssl rand -hex 32 |
| | `ADMIN_SESSION_SECRET` | admin JWT + TOTP v1 fallback key |
| | `TOTP_ENC_KEY` | DEDICATED key for TOTP-secret encryption at rest (rotating `ADMIN_SESSION_SECRET` must never break 2FA) |
| | `TRUST_PROXY` | `cf` behind Cloudflare / `1` behind own nginx — client-IP resolution for rate limiting |
| | `RESEND_API_KEY`, `MAIL_FROM` | transactional email (outbox-only without it) |
| | `REQUIRE_VERIFIED_EMAIL`, `REQUIRE_GUEST_EMAIL_OTP` | policy switches (see Security model) |
| | `SITE_URL` | canonical origin for emailed links |
| | `ALLOWED_ORIGINS` (var, not secret) | direct-browser API origins; **fail-closed default `""`** — the storefront/admin reach the API same-origin through their proxies |
| **apps/storefront** | `SESSION_SECRET` | edge middleware pre-verifies customer JWTs — MUST equal the API's |
| | `BACKEND_ORIGIN` | proxy target (default `http://localhost:8787`) |
| | `NEXT_PUBLIC_SITE_URL` | robots/sitemap origin (baked at BUILD time) |
| **apps/admin** | `ADMIN_SESSION_SECRET` | edge middleware pre-verifies admin JWTs — MUST equal the API's |
| | `BACKEND_ORIGIN` | proxy target |
| | `NEXT_PUBLIC_SITE_URL` | this app's public origin |

Full templates: `apps/api/.dev.vars.example`, `apps/storefront/.env.example`,
`apps/admin/.env.example`. Production secrets go in `wrangler secret put`;
rotating `TOTP_ENC_KEY` invalidates stored 2FA secrets (affected admins
re-enroll; recovery codes keep working — they are stored key-free).

## Golden path

```
Browse → Product → Variant → Add to Cart → Checkout (COD)
→ Atomic order transaction (stock guard + counter order number + coupon guard)
→ Order SN100xxx → Stock decrement → Low-stock notification
→ Supplier orders processed in the background (with retry)
→ Order confirmation email (outbox)
→ Server Purchase event → Analytics → Admin dashboards
→ Admin status flow (PENDING → … → DELIVERED) with validated transitions
→ Cancel/Return restores reserved stock exactly once
```

## Architecture

### Monorepo — three deployables + shared packages

| App | Deploy as | Serves | Notes |
|---|---|---|---|
| `apps/storefront` | standalone Next.js (Node/Bun) | customer UI (`/`) — **pure UI + proxy tier, no database** | every `/api/*` call is proxied at RUNTIME to `BACKEND_ORIGIN` → `/v1/*` (same-origin cookies preserved, Set-Cookie forwarded verbatim); server components fetch `/v1/storefront/*` bundles via `apiGet`; `/uploads/*` + media paths proxy to the R2-backed `/v1/media/*`; edge middleware pre-verifies customer JWTs (nonce CSP) |
| `apps/admin` | standalone Next.js (Node/Bun) | admin UI only (`/admin/**`) — **no database, no business logic** | same proxy pattern for `/api/admin/*` → `/v1/admin/*`; the shell layout's session check calls `/v1/admin/auth/me`; media paths proxy to R2 |
| `apps/api` | Cloudflare Worker (Hono) | **the entire backend**: versioned REST `/v1/*` (public + customer + admin surfaces) + `/health` + R2 media + scheduled jobs | D1 (SQL migrations) + R2; per-IP rate limiting in D1; Prisma 6 client on the D1 adapter; CORS + security headers; hourly cron (supplier sync, supplier-order retry, tracking retention) |
| `packages/shared` | — | API contracts: response envelope, zod schemas, pagination, `API_VERSION` | imported by `apps/api` |

Visiting `shop.example.com/admin` returns 404 by design — the console is a
separate deployment. Both UI tiers are stateless: compromise of either cannot
leak customer data, and every authorization decision is re-made server-side by
the Workers API on every request.

### Key subsystems (all in `apps/api/src/lib` — the business tier; both UI apps consume them only through the HTTP API)
| Subsystem | Where | Notes |
|-----------|-------|-------|
| Auth | `apps/api/src/lib/{jwt,password,auth,admin-auth,totp,recovery}.ts` | PBKDF2-SHA256 (600k iter, transparent upgrade of old hashes), HS256 session cookies with `tokenVersion` revocation (password change / deactivation kills all sessions), TOTP 2FA for admins with **one-time recovery codes** (lost device no longer locks the account out) |
| RBAC | `apps/api/src/lib/permissions.ts` | SUPER_ADMIN / ADMIN / MANAGER / SUPPORT / MARKETING + validated per-admin overrides |
| Checkout | `apps/api/src/lib/checkout.ts` | Single `db.$transaction`: guarded atomic stock decrement, atomic order-number counter, atomic coupon usage (+ per-customer limits incl. GUESTS via email/phone identity). Write-lock contention is retried; ANY invalid cart line blocks the order. Post-commit side effects (mail, notifications, analytics) are failure-isolated — the customer never sees a false error after a committed order. The guest email itself is OPTIONAL (round 5, COD-first store); a guest who DOES give an email confirms it with a one-time code (`src/lib/guest-otp.ts`) |
| Order lifecycle | `apps/api/src/lib/order-flow.ts` | Status transition map (no backwards jumps), cancel/return restores stock idempotently and RELEASES the order's unverified TrxID claim (renamed `<TRXID>-RELEASED-<orderNumber>`) so the buyer's real transfer can fund a replacement order. Round 5: the admin route applies payment-status changes BEFORE the release step, so the combined save `status=CANCELLED + paymentStatus=PAID + smsVerified=true` (money arrived, refunded outside the system, order cancelled) flips the payment to SUCCESS first — the verified TrxID then stays LOCKED instead of being released |
| Payments | `apps/api/src/lib/checkout.ts`, admin Settings | COD native; bKash/Nagad via **manual verification** (customer sends money to the merchant number, submits the TrxID at checkout, staff verifies on the order page — which shows the EXPECTED AMOUNT and the customer's TrxID side by side in large type plus the merchant number, and requires an explicit “I matched the amount and TrxID against the merchant SMS/statement” tick before the payment can be marked Paid — enforced server-side via `smsVerified`, not just in the UI; the tick is written to the audit log as `payment.sms_verified` with the acting admin, TrxID, amount and timestamp — round 5). `Payment.transactionId` has a **UNIQUE index**: the same TrxID can never attach to two orders (rejected at checkout + race-safe at the DB level); reserved prefixes (`COD-`, `MANUAL-`, `REFUND-`) and released IDs (`-RELEASED-`) are rejected at checkout. Admin verification flips the buyer's own payment row — no detached synthetic records. **Cancelling/returning an order releases its still-UNVERIFIED TrxID** (renamed for the audit trail, original free to reuse); verified (SUCCESS) references stay locked — a refunded transfer must not prove a second payment. If the money DID arrive and was refunded outside the system, mark the payment Paid in the SAME save as the cancel (round 5: the admin UI warns about this whenever a cancel would release a live claim). Card payment is hard-disabled until a real gateway is integrated |
| Suppliers | `apps/api/src/lib/suppliers/*` | `SupplierAdapter` interface + **demo adapter only** (sandbox — no real supplier API is integrated; dropshipping against a real wholesaler requires writing an adapter and credentials). Sync engine, background order placement with attempt counting |
| Tracking | `apps/api/src/lib/tracking.ts` (collector) + `apps/storefront/src/lib/tracking-client.ts` (beacon) | First-party collector with HMAC-signed sessions, **server-only Purchase events**, per-session hourly event quotas (spoofed AddToCart floods are bounded), session/UTM attribution, consent enforcement, 180-day retention |
| Pixels | `apps/api/src/lib/pixels.ts` | Meta CAPI, GA4 MP, TikTok Events API, custom webhook (SSRF-guarded, timed out) — secrets stay server-side |
| Analytics | `apps/api/src/lib/analytics.ts` | KPIs, daily series, funnel, campaigns, product/search analytics, abandoned carts, consent stats, live activity. Revenue is always sourced from ORDERS (authoritative) |
| Storage | `apps/api/src/lib/storage.ts` | Magic-byte type verification, SVG banned; **R2-backed for reads AND writes** (`/v1/media/*` serves the bucket; `/v1/admin/upload` writes it). Note: the Node-only sharp re-encode does not exist on Workers — R2-stored bytes are the exact validated payload, and SVG stays banned |
| Mail | `apps/api/src/lib/mailer.ts` | Outbox pattern + optional Resend delivery for order confirmations (guests included), status updates, password resets, email verification. **One-time tokens are redacted before outbox storage**. Round 5: delivery outcomes feed an outage breaker — 3 consecutive failures relax the guest-OTP gate automatically for 10 minutes (one probe attempt is allowed after the cooldown; a further failure re-trips it) |

### Security model
- httpOnly + sameSite cookies, separate admin/customer sessions (8h / 7d), both revocable
- **Email verification policy**: checkout NEVER gates on email verification for SIGNED-IN buyers — a gate that only blocked signed-in users was trivially bypassed by logging out, and without a mail provider it deadlocked new accounts entirely (round 3). **The guest email itself is OPTIONAL (round 5)** — a COD-first store where many buyers have no email at all; a guest who gives no email simply gets no confirmation mail, and is never asked for a code (no email → no mail → nothing to abuse). A guest who DOES submit an email must confirm it with a **one-time 6-digit code** (`src/lib/guest-otp.ts`) — but only while a mail provider is configured AND HEALTHY: during a detected provider outage the gate relaxes automatically (round 5 breaker — a Resend outage used to block every guest order until someone hand-edited `REQUIRE_GUEST_EMAIL_OTP=0`; during an outage no mail can leave the server, so the anti-spam property holds by construction). Codes are hashed at rest, expire in 10 minutes, allow 5 wrong entries (burned by a single atomic conditional UPDATE — round 5), are single-use, and issuance is throttled per IP AND per target email (3/10 min) **plus a hard per-email DAILY cap of 10** (round 5: IP rotation cannot sustain mail-bombing past that bound). `REQUIRE_GUEST_EMAIL_OTP=0` disables the gate explicitly. Reviews DO require a verified email, again only while a mail provider is configured (`src/lib/email-gate.ts`; `REQUIRE_VERIFIED_EMAIL=0` disables). Without a provider no mail ever leaves the server (outbox only), so there is nothing to abuse.
- **Rate limiting**: fixed windows persisted in **D1 (`RateLimitEntry`)** — one shared store across every Worker instance, no second database to operate. If D1 is momentarily unavailable the limiter degrades to a per-isolate in-memory window — it never fails OPEN. Trusted-proxy-aware IP resolution (see deployment matrix) + **per-email lockouts** on logins and 2FA (IP rotation cannot dodge them). Unresolvable-IP requests share one bucket with a proportionally scaled limit, so one anonymous attacker cannot block the whole site.
- One-time hashed tokens for password reset / email verification (no account enumeration); token redemption is race-safe (conditional update)
- Admin TOTP secrets **encrypted at rest** (AES-256-GCM) with a versioned key derivation: v1 from `ADMIN_SESSION_SECRET` (legacy), v2 from the dedicated `TOTP_ENC_KEY`. Old rows decrypt and are transparently upgraded on next use. **Code-replay protection** (consumed time-steps recorded atomically) + **per-email 2FA lockout**.
- **2FA recovery codes**: 8 one-time codes shown exactly once at enable/regeneration, stored only as SHA-256 lookup hashes (key-free — secret rotation never breaks them, and a DB leak reveals nothing usable). Consumption is an atomic conditional update; regeneration invalidates the previous set and accepts a current TOTP code or an unused recovery code.
- **Nonce-based CSP** (no `unsafe-inline`/`unsafe-eval` for scripts) + security headers in `next.config.ts`; JSON-LD escaped against `</script>` breakout. All JSON API responses are `Cache-Control: no-store` (user-context payloads must never be replayed by a browser heuristic cache).
- CSV exports neutralize formula injection (`=`, `+`, `-`, `@`)
- SSRF guard on operator-configured outbound URLs (custom webhooks, supplier base URLs)
- Full audit log of sensitive admin actions, with alerting when an audit write fails
- Type errors fail the build (`ignoreBuildErrors: false`); ESLint rules active

## Data model (33 tables)
`Admin`, `AdminRecoveryCode`, `Customer`, `AuthToken`, `GuestEmailOtp`, `Address`, `Category`, `Product`, `ProductImage`, `ProductVariant`, `Tag`, `ProductTag`, `ProductRelation`, `Supplier`, `SupplierProduct`, `SupplierSyncLog`, `SupplierOrder`, `SequenceCounter`, `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `Coupon`, `Banner`, `HomepageSection`, `Review`, `Setting`, `TrackingSession`, `TrackingEvent`, `TrackingIntegration`, `CookieConsent`, `MailOutbox`, `Notification`, `AuditLog`.

(`RateLimitEntry` is provisioned by D1 migration `0002` — a single shared store for every Worker instance.)

Prisma (`apps/api/prisma/schema.prisma`, `prisma-client` generator on the D1 adapter) is the single source of truth; the DATABASE is Cloudflare D1 and migrations are **versioned SQL** (`apps/api/migrations/`):
- Fresh install / local: `bun run db:migrate:local` (`wrangler d1 migrations apply suman-mart --local`) — `bun run db:seed:local` does this + fixtures
- Production: `bun run db:migrate:remote` (… `--remote`) — **create a time-travel bookmark first**; restore is the rollback path
- Schema changes: edit the Prisma schema, `bun run --cwd apps/api db:generate`, then write/review the D1 migration SQL by hand (the guarded-checkout SQL in `0003_checkout_guard.sql` and the stock-restore token in `0004` are load-bearing — do not regenerate them blindly)

**Migrating an existing SQLite database (the legacy monolith) into D1**: run the source-SQLite toolkit in order — `apps/api/scripts/source-sqlite/{dedupe-reviews,check-trxid-duplicates,fix-product-images}.ts` (see its README) — then `bun apps/api/scripts/export-to-d1.ts db/custom.db` (FK-ordered INSERT chunks; **converts DateTime columns from epoch-millis INTEGER to ISO-8601 TEXT**, the representation the D1 adapter requires — skipping this silently breaks every date-range query), then `wrangler d1 execute suman-mart --remote --file …` and validate against the printed per-table row counts. Media: `bash apps/api/scripts/migrate-media-to-r2.sh` (dry-run first). Neither tool deletes or mutates source data.

## API overview

**Everything is served by the Workers API under `/v1`** (documented in
`docs/API.md`). The storefront and admin apps keep their historical same-origin
`/api/*` URLs — the runtime proxies map them 1:1 (`/api/<x>` →
`${BACKEND_ORIGIN}/v1/<x>`), so browser code never sees a cross-origin request
and cookies stay first-party.

**Public + customer** (storefront proxies these) — `GET /health`,
`GET /v1/products` (q/category/tag/price/availability/featured filters + 7
sorts + pagination; `costPrice` never exposed), `GET /v1/products/:slug`
(detail + variants + approved reviews + recommendations + FBT),
`GET /v1/categories`, `GET /v1/settings/public`,
`POST /v1/orders/track` (phone-matched, rate-limited),
`GET /v1/media/*` (R2), `/v1/auth/{register,login,logout,me,forgot,reset,verify-email}`,
`POST /v1/cart/validate`, `POST /v1/checkout` (+ `/v1/checkout/guest-otp` —
one-time email code for guest checkout, only for guests who give an email and
only while a mail provider is configured & healthy; answers `sent:false`
honestly on a delivery failure), `/v1/account/*`, `/v1/reviews`,
`/v1/tracking/{session,events,consent}`.

**Server-component bundles** (RSC data, cookie-authenticated) —
`GET /v1/storefront/{layout,home,product/:slug,order-success/:orderNumber,sitemap,account/overview,account/orders,account/order/:orderNumber}`.

**Admin** (auth + permission guarded, consumed by `apps/admin` through its
proxy) — `/v1/admin/auth/{login,logout,me,password,totp}`,
`/v1/admin/dashboard`, `/v1/admin/products(+/[id],/bulk)`,
`/v1/admin/orders(+/[id])`, `/v1/admin/customers(+/[id])`,
`/v1/admin/{categories,coupons,banners,reviews}`,
`/v1/admin/suppliers(+/[id]/sync, /products/import, /orders/[id])`,
`/v1/admin/analytics/{overview,funnel,events(+/[id]),campaigns,products,searches,consent,abandoned,live}`,
`/v1/admin/settings(+/test-integration)`, `/v1/admin/notifications`,
`/v1/admin/upload` (→ R2), `/v1/admin/reports/export?type=…&range=…` (CSV),
`/v1/admin/team`, `/v1/admin/maintenance`.

**Scheduled** (hourly cron, `wrangler.jsonc`) — supplier price/stock sync,
retry of failed supplier orders, tracking-data retention.

## Scripts

Root scripts delegate into the workspace apps:
```
bun run dev            # storefront dev server (port 3000) — needs dev:api running
bun run dev:admin      # admin app dev server (port 3001) — needs dev:api running
bun run dev:api        # Workers API (wrangler dev, port 8787) — start here
bun run build          # production builds: storefront + admin (standalone)
bun run lint           # eslint (both UI apps)
bun run test           # API suite (103: unit + integration on real local D1+R2)
                       #   + storefront unit suite (8)
bun run typecheck      # tsc --noEmit for all three apps
bun run db:migrate:local / :remote   # wrangler d1 migrations apply
bun run db:seed:local  # dev fixtures: catalogue + admin accounts + R2 images
cd apps/api && bun run deploy        # wrangler deploy (production API)
```

E2E drivers (three-tier topology — see `apps/storefront/tests/e2e/`):
```
E2E_BOOT=1 bash tests/e2e/boot.sh        # boot API + storefront(:3111) + admin(:3112)
E2E_JOURNEYS=1 bun tests/e2e/journeys.ts # 49 checks: customer + admin journeys
E2E_ROUND5=1 bun tests/e2e/round5.ts     # 38 checks: outage breaker + TrxID locks
```

## Deployment

**Three independently deployable apps.** The storefront and admin app are standalone
Next.js servers (Node or Bun); the API is a Cloudflare Worker with D1 + R2 bindings.

### A. API (`api.example.com`) — Cloudflare Workers + D1 + R2 — DEPLOY THIS FIRST

```bash
cd apps/api
wrangler d1 create suman-mart            # put the returned database_id in wrangler.jsonc
wrangler r2 bucket create suman-mart-media
bun run db:generate                      # prisma client (workerd runtime) + wasm patch
wrangler d1 migrations apply suman-mart --remote
# secrets (all required for production):
wrangler secret put SESSION_SECRET       # openssl rand -hex 32 — SAME value the storefront gets
wrangler secret put ADMIN_SESSION_SECRET # openssl rand -hex 32 — SAME value the admin app gets
wrangler secret put TOTP_ENC_KEY         # openssl rand -hex 32
wrangler secret put RESEND_API_KEY       # when transactional mail is wanted
bun run deploy                           # wrangler deploy (also registers the hourly cron)
```

- `vars` in `wrangler.jsonc`: set `ALLOWED_ORIGINS` (comma-separated) only if browsers will call the API directly (the storefront/admin proxies are same-origin and need nothing); keep the fail-closed default `""` otherwise. Set `ENVIRONMENT=production`.
- `TRUST_PROXY=cf` is the right value when the API is fronted by Cloudflare itself (the normal case).
- Data + media migration from the legacy SQLite monolith: see **Data model** above (source-sqlite toolkit → export-to-d1 → migrate-media-to-r2; time-travel bookmark first).
- Rollback: `wrangler deployments rollback` for code; D1 time-travel restore for data.

### B. Storefront (`shop.example.com`) — Node/Bun, pure UI + proxy

1. Provision Node 20+ / Bun 1.1+; run behind nginx/Caddy/Cloudflare with TLS (HSTS is automatic in production builds).
2. `cd apps/storefront && bun install && bun run build && bun run start`.
3. Environment: `BACKEND_ORIGIN=https://api.example.com`, `SESSION_SECRET` (**must equal the API's** — the edge middleware pre-verifies customer JWTs with it; the API re-verifies every request server-side), `NEXT_PUBLIC_SITE_URL=https://shop.example.com` (baked at build time).
4. No database, no volumes, no secrets beyond the session key — scale horizontally at will; every request's authority lives in the API.
5. The standalone server lives at `apps/storefront/.next/standalone/apps/storefront/server.js` (bun-workspace layouts are nested — the build script copies `static/` + `public/` into place).

### C. Admin app (`admin.example.com`) — Node/Bun, UI only

1. `cd apps/admin && bun install && bun run build && bun run start` (port 3001 by default; front it with TLS).
2. Environment: `BACKEND_ORIGIN=https://api.example.com`, `ADMIN_SESSION_SECRET` (**must equal the API's**), `NEXT_PUBLIC_SITE_URL=https://admin.example.com`.
3. The admin app has **no database and no business logic** — compromise of the admin deployment cannot leak customer data; the same RBAC still applies at the backend.
4. Because both UI apps proxy at the HTTP layer, per-IP rate limits on the API see the proxy IP — per-EMAIL lockouts (admin login, 2FA) remain exact, and both apps forward `x-forwarded-for` so trusted-proxy resolution still works.

### Client IP & proxy configuration

How `src/lib/rate-limit.ts → clientIp()` resolves the client address per deployment — the direct-exposure behaviour was **verified empirically against the standalone Next.js 16 server**:

| Deployment | TRUST_PROXY | Resolution order | Notes |
|---|---|---|---|
| Behind Cloudflare | `cf` | `cf-connecting-ip` → `x-real-ip` → last `x-forwarded-for` | Cloudflare overwrites client-supplied copies of its header, so it cannot be forged |
| Behind your own nginx/Caddy | `1` | `x-real-ip` → last `x-forwarded-for` | Your proxy APPENDS the real client IP, so the last XFF entry is trustworthy; `cf-connecting-ip` is deliberately ignored (forgeable without Cloudflare) |
| Direct exposure | unset | single-entry `x-forwarded-for` only | **Verified**: Next's Node server injects the socket address into `x-forwarded-for` when (and only when) the client sent none — honest clients get correct per-IP limits. A malicious client CAN forge a single-entry XFF and rotate buckets; multi-entry XFF → shared "unknown" bucket with a scaled (20×) limit so one attacker cannot block everyone. Per-identity limits (email, session) are the rotation-proof backstop |

For hardened deployments, put a reverse proxy in front and set the matching `TRUST_PROXY` value.

### Performance notes
- **Nonce CSP requires per-request rendering**: every storefront page renders dynamically (`force-dynamic`) because each response carries a fresh nonce, so there is no static full-page caching. This is a deliberate security/throughput trade-off; API responses are `no-store` by design (user-context aware).
- **Pixel loading with `strict-dynamic` was browser-verified**: after consent, the real `fbevents.js` / `gtag.js` scripts load (injected by the trusted app bundle) with ZERO CSP violations.
- Checkout is a SINGLE atomic D1 batch (guarded INSERT..SELECT..WHERE + conditional updates) — no interactive transaction, no write-lock convoy; real D1 serializes writes natively.
- R2 media responses carry immutable cache headers; product images are served through the storefront's media proxy so the browser sees first-party URLs.

### Known limitations (deliberate, documented)
- **Supplier integration is a demo adapter** — no real dropshipping API is wired; writing a real `SupplierAdapter` + credentials is required (the sync/placement/retry engine around it is real and tested).
- **Coupon per-customer limits for guests** are keyed on email + phone. A determined guest can dodge them by rotating both — inherent to anonymous checkout; the global usage limit still caps the damage.
- **Fixed-window rate limits** may allow ~2× a limit across a window boundary (accepted trade-off for cross-instance-correct counting).
- **bKash/Nagad verification is manual**: the TrxID is only the buyer's claim — the system cannot match amounts or sender numbers (no gateway API). The order page shows the expected amount + merchant number + TrxID in large type and requires an explicit SMS-match confirmation (`smsVerified`) before a payment can be marked Paid. Card payment stays hard-disabled until a real gateway is integrated.
- **sharp re-encode is gone on Workers**: uploaded images are stored byte-exact after magic-byte + size validation (SVG banned). If payload-stripping re-encoding is required, run an image pipeline against the R2 bucket separately.
- **Single D1 database**: D1 is one primary + read replicas; extremely high write throughput may eventually need sharding or Turso/Postgres — the Prisma schema ports directly, and every guarded write is already a single-statement conditional UPDATE.

**Production hardening checklist**
- Run all three tiers behind TLS; HSTS is enabled automatically in production builds.
- Set the API secrets (`SESSION_SECRET`, `ADMIN_SESSION_SECRET`, `TOTP_ENC_KEY`, `RESEND_API_KEY`) via `wrangler secret put`; mirror the two session secrets into the respective UI apps' environments.
- Configure `RESEND_API_KEY` for transactional mail (password reset requires it — tokens are redacted in the outbox by design; it also activates the guest-checkout email OTP for guests who give an email). If Resend has an outage the OTP gate relaxes automatically after 3 consecutive failed deliveries (round-5 breaker) — no env hand-editing, and no mail-bombing vector opens because nothing can be delivered during the outage.
- Media lives in R2 (`/v1/media/*`) — no volume management for either UI tier.

**Cloudflare migration: COMPLETE.** All write-paths (auth, checkout, tracking
ingestion, admin CRUD), the RSC data bundles, media (R2), rate limiting (D1) and
the scheduled jobs run on the Workers API — the storefront and admin app are
pure UI + proxy tiers with zero database access. See
`docs/FEATURE-INVENTORY.md §8` for the phase history and
`docs/VERIFICATION-REPORT.md` for the final verification matrix.

## QA — verified against the production build

Every fix below was verified against `next build` + the standalone production server with automated and manual probes:

| Area | Verified |
|------|----------|
| Concurrency | 6 simultaneous checkouts on a stock-3 product → exactly 1 order, 5 clean "out of stock" responses; no oversell, no 500s, no duplicate order numbers. **16-way race for 5 units → exactly 5 winners / 11 clean rejections, stock 0, never negative** (unit-tested against a real SQLite DB); variant-level 10-way race for 3 units → exactly 3 winners |
| Checkout integrity | Mixed valid+invalid cart → entire order blocked with per-item reasons; oversell attempts blocked; coupon usage incremented atomically; per-customer limits enforced |
| Auth | Legacy 100k-iteration hashes auto-upgrade on login; password change/reset revokes all sessions (old token → `customer: null` / 401); reset tokens are single-use |
| 2FA | TOTP setup → wrong code rejected → enable → login demands code → code succeeds; **recovery-code login works, reuse of a spent code is rejected, regeneration invalidates the old set; secrets stored v2-encrypted under the dedicated TOTP_ENC_KEY; v1 rows still decrypt and upgrade transparently** |
| Email verification | Checkout does NOT gate for signed-in buyers (unverified + logged-in customer ordered successfully with no mail provider — previously a deadlock); reviews gate only with a provider configured; **guest checkout: the email is OPTIONAL — a guest without an email orders with no code at all, a guest WITH an email gets a one-time code while a provider is configured & healthy (issue → 6-digit code hashed at rest → wrong code rejected → single-use; without a provider the step disappears entirely — no mail leaves the server)**; the endpoint answers `sent:false` honestly when the provider just failed, and a detected outage relaxes the gate automatically; OTP mail body is redacted in the outbox |
| Manual payments | Same bKash TrxID on a second order → 409; reserved `MANUAL-`/`COD-`/`REFUND-` prefixes and released (`-RELEASED-`) IDs rejected at checkout; race-safe unique index; admin PAID flips the buyer's payment row (TrxID preserved, no detached MANUAL-* record); **PAID without the `smsVerified` SMS-match confirmation → 422, and the tick is audited (`payment.sms_verified` records who confirmed, for which TrxID/amount, when)**; **cancelling an order releases its unverified TrxID (renamed `<TRXID>-RELEASED-<SN…>`) and the buyer can immediately place a new order with the same TrxID**; **the combined save PAID+CANCELLED (with the SMS tick) keeps the TrxID locked instead — the payment flip runs before the release step (round 5)**; verified (SUCCESS) references stay locked |
| Rate limiting | Buckets persist in the DEDICATED `db/ratelimit.db` (verified in production standalone — main DB never sees limiter writes); admin-login 429 after 8 attempts; unknown-IP requests share a scaled bucket |
| Tracking | Forged/unsigned session keys → 403; browser-sent Purchase events dropped (server-only); valid signed beacons recorded |
| CSP / pixels | Homepage after consent: real `fbevents.js` (fbq.version 2.9.412) + `gtag.js` loaded via `strict-dynamic`, **zero CSP violations, zero console errors**; all JSON APIs `Cache-Control: no-store` |
| Uploads | SVG (with embedded script) rejected; client-supplied MIME type ignored (magic bytes); real PNGs re-encoded through sharp |
| Order lifecycle | PENDING→DELIVERED blocked with allowed-next list; CANCELLED restores stock exactly once (idempotent) and releases the unverified TrxID; terminal states locked |
| Migrations | round-3 unique-index migration **self-heals legacy duplicate/empty `transactionId`s** (oldest keeps the ID, younger renamed `-DUP-<rowid>`, `''`→NULL) — verified against a scratch DB seeded with duplicates, then the index creates cleanly; read-only pre-deploy report: `bun scripts/check-trxid-duplicates.ts` |
| Admin team | Unknown permission → 422; short password → 422; last SUPER_ADMIN demotion blocked; unknown ID → 404 |
| Settings | Wrong types / negative shipping rejected by zod schemas |
| Exports | CSV formula-injection neutralized (unit-tested) |
| SSRF | Private IPs, localhost, `.internal`, non-HTTPS blocked for webhooks/supplier URLs |
| Builds | `tsc --noEmit` clean, ESLint 0 errors, 93 vitest tests green (unit + checkout/stock/coupon/concurrency integration), production build with `ignoreBuildErrors: false` |
| Monorepo split | After moving the monolith to `apps/storefront`: same 93 tests green, tsc clean, build green, root `bun run dev` still serves :3000. Admin UI extracted to `apps/admin` (pure UI + runtime proxy): tsc clean, build green, **browser-verified E2E on the production standalone pair (:3111 storefront / :3112 admin)** — login through the proxy (cookie round-trip), dashboard KPIs, orders list + detail, **write path (status PENDING→CONFIRMED + note) persisted in the DB with operator identity through the proxy (sameOrigin CSRF passes via x-forwarded-host forwarding)**, 24/24 product images via the media proxy, 7-tab product editor, analytics — zero console errors. Storefront after the split: `/admin` 404s, full guest COD journey re-verified end-to-end (order SN100354, no email → no OTP demanded, no outbox mail, tracking works), zero console errors |
| Workers API | **103 tests green against REAL local D1 + R2 (workerd, no mocks)**: health + live-DB check, products list (default order, image mapping, q over name/shortDescription/brand, category/tag/price-range COMBINED/availability/featured filters, all sorts, pagination caps, 422 on invalid query), product detail (variants parsed, approved-only reviews, manual+auto recommendations, FBT, **costPrice never exposed**), categories with active-product counts, public settings (stored-over-defaults merge, pixels from integrations, secrets never in the response), order tracking (phone-match privacy rule, last-10-digit matching, identical 404 for wrong phone/unknown order, 422 validation, **429 after the 20/10min per-IP window**), R2 media route (content-type + immutable caching, 404 envelope, traversal rejected), CORS echo + preflight, baseline security headers on every response, standard 404/500 envelopes. **Write-paths (Phase 8): auth/session-revoke, checkout stock/coupon/TrxID guards, 8-way parallel checkout race → exactly-5-sold no-oversell, cancel → exactly-once stock restore, backwards-transition rejection; admin: RBAC, KPIs, analytics, CSV, CRUD, upload validation, settings validation, last-super-admin guard.** Ported pure-logic suites: PBKDF2 hashing/rehash detection, TOTP RFC vectors + secret encryption (v1/v2 + rotation semantics) + replay, recovery codes, url-guard SSRF, mailer redaction, email-gate policy matrix |
| **Phase 9 flip (three-tier E2E)** | **journeys 49/49 + round5 38/38 against the production standalone trio** (Workers API :8787 + storefront :3111 + admin :3112, one boot): customer home→categories→filtered/sorted list→search→detail→R2 image via media proxy→cart validate (server-priced)→guest COD checkout with WELCOME10→order-success page→tracking by phone→register/login→account overview (RSC bundle, cookie-forwarded)→orders page→addresses; admin login **through the admin app's proxy**→/me→dashboard KPIs→orders list/detail→**SMS-match guard (manual payments only — 422 without the tick, tick accepted)**→COD mark-received→PNG upload→R2 serve-back→analytics→customers→coupons→settings→suppliers; TrxID duplicate → 409; cross-origin write → 403. Round-5 regression suite re-verified on the flipped stack: provider-outage honesty + automatic gate relaxation, optional guest email, PAID+CANCELLED keeps the TrxID locked, plain cancel releases it, the tick is audited (`payment.sms_verified`), shipped UI copy. **A real flip bug was found and fixed by this suite**: all 6 storefront account pages called the RSC fetch without forwarding the session cookie (every /account page bounced to /login) |

Unit + integration tests: `bun run test` — the API suite (103, above) plus the storefront unit suite (8: CSV/JSON-LD escaping). The historical SQLite-era suites (93 tests) were superseded by the D1 write-path tests when the backend moved to Workers — same coverage, real D1, including stock races, coupon limits incl. guest identity, TrxID uniqueness under concurrency and post-commit failure isolation.

E2E drivers: `apps/storefront/tests/e2e/` — `boot.sh` boots the production trio; `journeys.ts` (49 checks, customer + admin) and `round5.ts` (38 checks, outage breaker + payment lock semantics) drive them through the real proxies; helpers (`admin-pw`, `inject-otp`, `rl-clear`, `totp-code`) manipulate the LOCAL D1 only, behind explicit opt-in env guards.
