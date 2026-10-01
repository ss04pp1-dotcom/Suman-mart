# ShopNest — Full-Stack E-Commerce & Dropshipping Platform

A production-grade e-commerce platform with a **customer storefront** and a **separate admin management console** sharing one backend, one database, and one tracking/analytics engine.

```
Customer (shop.example.com)          Admin (admin.example.com)
        │                                    │
        └──────────────┬─────────────────────┘
                       ▼
              REST API (Next.js route handlers)
                       │
        ┌──────────────┼─────────────────┐
        ▼              ▼                 ▼
   SQLite (Prisma)  Image storage     Supplier APIs
   (database)       (local / R2)      (adapter interface)
        │
        ▼
   Tracking & Analytics Engine (first-party, cookie-consent aware)
        │
   ┌────┴─────────┬──────────────┐
   ▼              ▼              ▼
 Meta CAPI    GA4 Measurement  TikTok Events API
 (server-side forwarding, browser+server event-ID dedup)
```

## Quick start

```bash
git clone <repo-url> shopnest && cd shopnest
bun install                # or npm/pnpm install
cp .env.example .env       # then set the secrets (see below)
bun run db:generate        # generate the Prisma client
bun run db:deploy          # create the SQLite schema (prisma migrate deploy)
bun run db:seed            # seed demo data + create the admin account
bun run dev                # http://localhost:3000  (storefront + /admin)
```

### Seeded credentials

`bun run db:seed` creates the admin account from the environment:

| Variable | Meaning |
|----------|---------|
| `ADMIN_SEED_EMAIL` | admin login email (default `admin@shopnest.com`) |
| `ADMIN_SEED_PASSWORD` | admin password. **When unset, a random password is generated, printed once to the console, and the account is flagged `mustChangePassword`** — the console forces a password change on first login. |

The seeded demo dataset contains 37 products, 8 categories, 330+ orders across 30 days, 2 suppliers, 2,500+ tracking sessions and 10,000+ events with a realistic conversion funnel — enough to explore every dashboard.

Demo coupons: `WELCOME10` (10% ≤ ৳300), `SHOPNEST500` (৳500 off ≥ ৳4,000), `FREESHIP` (free shipping ≥ ৳800).

> ⚠️ The SQLite database is **never committed** (it contains password hashes and order data). Always seed your own.

## Environment variables

```
DATABASE_URL=file:./db/custom.db     # SQLite via Prisma (absolute path in sandboxes)
RATELIMIT_DATABASE_URL=file:./db/ratelimit.db
                                     # SEPARATE SQLite file for rate-limit buckets —
                                     # limiter writes never contend with checkout for
                                     # the main database's write lock. Single-machine /
                                     # single-volume only: multiple servers or a network
                                     # volume need Redis/KV instead (swap the layer in
                                     # src/lib/rate-limit.ts — the signature is kept)
SESSION_SECRET=…                     # customer session signing — openssl rand -hex 32
ADMIN_SESSION_SECRET=…               # admin session signing
TOTP_ENC_KEY=…                       # DEDICATED key for TOTP-secret encryption —
                                     # openssl rand -hex 32. MANDATORY IN PRODUCTION
                                     # (round 4: the server refuses to boot without
                                     # it). Otherwise the key is derived from
                                     # ADMIN_SESSION_SECRET, so rotating that secret
                                     # breaks every admin's 2FA

# ── Public origin for emailed links ─────────────────────────────
# NEXT_PUBLIC_* variables are INLINED INTO THE BUNDLE AT BUILD TIME (in server
# code too). A value set only at runtime is invisible to already-built code.
#   • Set NEXT_PUBLIC_SITE_URL when you BUILD, or
#   • set the plain SITE_URL on the server at RUNTIME (it takes precedence),
#   • or both.
NEXT_PUBLIC_SITE_URL=https://…
# SITE_URL=https://your-domain.com

# ── Client-IP trust for rate limiting ──────────────────────────
#   TRUST_PROXY=1   behind YOUR OWN nginx/Caddy: trusts x-real-ip, then the
#                   LAST x-forwarded-for entry (the one YOUR proxy appended)
#   TRUST_PROXY=cf  behind Cloudflare: trusts cf-connecting-ip (Cloudflare
#                   overwrites client-supplied copies; with any other proxy
#                   this header is FORGEABLE — use "cf" only behind Cloudflare)
#   unset           direct exposure — see the verified behaviour in
#                   “Deployment notes → Client IP & proxy configuration”
# TRUST_PROXY=1

# Optional transactional email (order confirmations, password resets).
# One-time tokens are REDACTED in the outbox (a DB leak must never enable
# account takeover). In development the full link is printed to the console.
# RESEND_API_KEY=
# MAIL_FROM="ShopNest <no-reply@shopnest.com>"

# Optional: require a verified email before customers can write reviews.
# Only effective while RESEND_API_KEY is set (without a provider, verification
# is impossible and the gate stays off). Checkout NEVER gates on email
# verification for SIGNED-IN buyers — see “Security model”. GUESTS however
# confirm their checkout email with a one-time code while a provider is set.
# REQUIRE_VERIFIED_EMAIL=0

# Optional: disable the guest-checkout email OTP described above (it also
# relaxes automatically while the mail provider is in a detected outage).
# REQUIRE_GUEST_EMAIL_OTP=0
```

Secrets are validated at server startup (`src/instrumentation.ts`): the server refuses to boot in production when `SESSION_SECRET` / `ADMIN_SESSION_SECRET` / `TOTP_ENC_KEY` are missing or shorter than 32 characters (round 4 made `TOTP_ENC_KEY` mandatory — without a dedicated key, rotating `ADMIN_SESSION_SECRET` silently breaks every admin's 2FA), and warns about a localhost site URL and about a missing `TRUST_PROXY` (direct exposure allows rate-limit bucket rotation via forged `x-forwarded-for`). Rotating `TOTP_ENC_KEY` invalidates stored 2FA secrets (affected admins re-enroll; recovery codes keep working — they are stored key-free).

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

### Two applications, one platform
- `src/app/(shop)/**` — **Customer storefront**: homepage, catalog, product pages, cart, multi-step checkout, order tracking, account, wishlist, password reset, email verification. Conversion-focused UI, mobile-first.
- `src/app/admin/**` — **Admin console** (`/admin/login` is standalone; all other admin routes sit behind an auth-guarded shell). Dark sidebar, data-dense dashboards, desktop-first but fully responsive.
- `src/app/api/**` — shared REST API. Admin endpoints are protected by role-based permissions and audited; customer endpoints validate every mutation server-side.

### Key subsystems
| Subsystem | Where | Notes |
|-----------|-------|-------|
| Auth | `src/lib/jwt.ts`, `password.ts`, `auth.ts`, `admin-auth.ts`, `totp.ts`, `recovery.ts` | PBKDF2-SHA256 (600k iter, transparent upgrade of old hashes), HS256 session cookies with `tokenVersion` revocation (password change / deactivation kills all sessions), TOTP 2FA for admins with **one-time recovery codes** (lost device no longer locks the account out) |
| RBAC | `src/lib/permissions.ts` | SUPER_ADMIN / ADMIN / MANAGER / SUPPORT / MARKETING + validated per-admin overrides |
| Checkout | `src/lib/checkout.ts` | Single `db.$transaction`: guarded atomic stock decrement, atomic order-number counter, atomic coupon usage (+ per-customer limits incl. GUESTS via email/phone identity). Write-lock contention is retried; ANY invalid cart line blocks the order. Post-commit side effects (mail, notifications, analytics) are failure-isolated — the customer never sees a false error after a committed order. The guest email itself is OPTIONAL (round 5, COD-first store); a guest who DOES give an email confirms it with a one-time code (`src/lib/guest-otp.ts`) |
| Order lifecycle | `src/lib/order-flow.ts` | Status transition map (no backwards jumps), cancel/return restores stock idempotently and RELEASES the order's unverified TrxID claim (renamed `<TRXID>-RELEASED-<orderNumber>`) so the buyer's real transfer can fund a replacement order. Round 5: the admin route applies payment-status changes BEFORE the release step, so the combined save `status=CANCELLED + paymentStatus=PAID + smsVerified=true` (money arrived, refunded outside the system, order cancelled) flips the payment to SUCCESS first — the verified TrxID then stays LOCKED instead of being released |
| Payments | `src/lib/checkout.ts`, admin Settings | COD native; bKash/Nagad via **manual verification** (customer sends money to the merchant number, submits the TrxID at checkout, staff verifies on the order page — which shows the EXPECTED AMOUNT and the customer's TrxID side by side in large type plus the merchant number, and requires an explicit “I matched the amount and TrxID against the merchant SMS/statement” tick before the payment can be marked Paid — enforced server-side via `smsVerified`, not just in the UI; the tick is written to the audit log as `payment.sms_verified` with the acting admin, TrxID, amount and timestamp — round 5). `Payment.transactionId` has a **UNIQUE index**: the same TrxID can never attach to two orders (rejected at checkout + race-safe at the DB level); reserved prefixes (`COD-`, `MANUAL-`, `REFUND-`) and released IDs (`-RELEASED-`) are rejected at checkout. Admin verification flips the buyer's own payment row — no detached synthetic records. **Cancelling/returning an order releases its still-UNVERIFIED TrxID** (renamed for the audit trail, original free to reuse); verified (SUCCESS) references stay locked — a refunded transfer must not prove a second payment. If the money DID arrive and was refunded outside the system, mark the payment Paid in the SAME save as the cancel (round 5: the admin UI warns about this whenever a cancel would release a live claim). Card payment is hard-disabled until a real gateway is integrated |
| Suppliers | `src/lib/suppliers/*` | `SupplierAdapter` interface + **demo adapter only** (sandbox — no real supplier API is integrated; dropshipping against a real wholesaler requires writing an adapter and credentials). Sync engine, background order placement with attempt counting |
| Tracking | `src/lib/tracking.ts`, `tracking-client.ts` | First-party collector with HMAC-signed sessions, **server-only Purchase events**, per-session hourly event quotas (spoofed AddToCart floods are bounded), session/UTM attribution, consent enforcement, 180-day retention |
| Pixels | `src/lib/pixels.ts` | Meta CAPI, GA4 MP, TikTok Events API, custom webhook (SSRF-guarded, timed out) — secrets stay server-side |
| Analytics | `src/lib/analytics.ts` | KPIs, daily series, funnel, campaigns, product/search analytics, abandoned carts, consent stats, live activity. Revenue is always sourced from ORDERS (authoritative) |
| Storage | `src/lib/storage.ts` | Magic-byte type verification, sharp re-encode (strips payloads), SVG banned; swap internals for an R2 binding in production |
| Mail | `src/lib/mailer.ts` | Outbox pattern + optional Resend delivery for order confirmations (guests included), status updates, password resets, email verification. **One-time tokens are redacted before outbox storage**. Round 5: delivery outcomes feed an outage breaker — 3 consecutive failures relax the guest-OTP gate automatically for 10 minutes (one probe attempt is allowed after the cooldown; a further failure re-trips it) |

### Security model
- httpOnly + sameSite cookies, separate admin/customer sessions (8h / 7d), both revocable
- **Email verification policy**: checkout NEVER gates on email verification for SIGNED-IN buyers — a gate that only blocked signed-in users was trivially bypassed by logging out, and without a mail provider it deadlocked new accounts entirely (round 3). **The guest email itself is OPTIONAL (round 5)** — a COD-first store where many buyers have no email at all; a guest who gives no email simply gets no confirmation mail, and is never asked for a code (no email → no mail → nothing to abuse). A guest who DOES submit an email must confirm it with a **one-time 6-digit code** (`src/lib/guest-otp.ts`) — but only while a mail provider is configured AND HEALTHY: during a detected provider outage the gate relaxes automatically (round 5 breaker — a Resend outage used to block every guest order until someone hand-edited `REQUIRE_GUEST_EMAIL_OTP=0`; during an outage no mail can leave the server, so the anti-spam property holds by construction). Codes are hashed at rest, expire in 10 minutes, allow 5 wrong entries (burned by a single atomic conditional UPDATE — round 5), are single-use, and issuance is throttled per IP AND per target email (3/10 min) **plus a hard per-email DAILY cap of 10** (round 5: IP rotation cannot sustain mail-bombing past that bound). `REQUIRE_GUEST_EMAIL_OTP=0` disables the gate explicitly. Reviews DO require a verified email, again only while a mail provider is configured (`src/lib/email-gate.ts`; `REQUIRE_VERIFIED_EMAIL=0` disables). Without a provider no mail ever leaves the server (outbox only), so there is nothing to abuse.
- **Rate limiting**: fixed windows persisted in a DEDICATED SQLite database (`db/ratelimit.db`) so limiter writes never compete with the checkout transaction for the main database's write lock. If the limiter database is unavailable the limiter degrades to a per-process in-memory window — it never fails OPEN. Trusted-proxy-aware IP resolution (see deployment matrix) + **per-email lockouts** on logins and 2FA (IP rotation cannot dodge them). Unresolvable-IP requests share one bucket with a proportionally scaled limit, so one anonymous attacker cannot block the whole site.
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

(`RateLimitEntry` deliberately lives in a **second Prisma schema** — `prisma/ratelimit/schema.prisma` — backed by its own SQLite file, so rate-limit writes never contend with checkout. The table is created lazily on first use; no migration needed.)

Prisma (`prisma/schema.prisma`) is the single source of truth, managed with **versioned migrations** (`prisma/migrations/`):
- Fresh install / deploys: `bun run db:deploy` (`prisma migrate deploy` — applies pending migrations)
- Local schema changes: `bun run db:migrate` (`prisma migrate dev` — creates a new migration file)
- **Back up `db/custom.db` before every deploy** (simple file copy while the server is stopped); the migration history lives in `_prisma_migrations`.

**Deploying the round-3+ migrations onto a database created before them**: the round-3 migration adds a UNIQUE index on `Payment.transactionId`. Databases created before that could legally hold duplicates, so the migration **self-heals first** — empty strings become NULL, and for duplicate IDs the OLDEST row keeps the ID while younger ones are renamed `<id>-DUP-<rowid>` (bookkeeping only; no payment is altered). Inspect beforehand with the read-only report: `bun scripts/check-trxid-duplicates.ts`.
> Dev note (round-5 verification): the sandbox database applied the round-3 migration AFTER the self-heal edit — its stored checksum matches the current file byte-for-byte, and `bunx prisma migrate status` reports “Database schema is up to date!”. Any environment that applied the PRE-edit version would see a `migrate dev` checksum mismatch — in that case the index already exists, so `prisma migrate reset` (dev) is the clean path; `migrate deploy` environments are unaffected either way (deploy does not re-verify applied checksums). Do NOT revert the file: that would CREATE a mismatch against every database that applied the current version.

## API overview

**Customer** — `/api/products`, `/api/products/[slug]`, `/api/categories`, `/api/auth/{register,login,logout,me,forgot,reset,verify-email}`, `/api/cart/validate`, `/api/checkout`, `/api/checkout/guest-otp` (one-time email code for guest checkout — only for guests who give an email, and only while a mail provider is configured & healthy; answers `sent:false` honestly on a delivery failure), `/api/orders/track`, `/api/account/*`, `/api/reviews`, `/api/tracking/{session,events,consent}`, `/api/settings/public`

**Admin** (auth + permission guarded) — `/api/admin/auth/{login,logout,me,password,totp}`, `/api/admin/dashboard`, `/api/admin/products(+/[id],/bulk)`, `/api/admin/orders(+/[id])`, `/api/admin/customers(+/[id])`, `/api/admin/categories|coupons|banners|reviews`, `/api/admin/suppliers(+/[id]/sync, /products/import, /orders/[id])`, `/api/admin/analytics/{overview,funnel,events(+/[id]),campaigns,products,searches,consent,abandoned,live}`, `/api/admin/settings(+/test-integration)`, `/api/admin/notifications`, `/api/admin/upload`, `/api/admin/reports/export?type=…&range=…` (CSV), `/api/admin/team`, `/api/admin/maintenance`

## Scripts
```
bun run dev        # dev server (port 3000)
bun run build      # production build (type errors fail the build)
bun run start      # production server (standalone — Node or Bun)
bun run lint       # eslint
bun run test       # vitest: 84 unit + integration tests
bun run db:deploy  # apply migrations (use this in production)
bun run db:migrate # create a new migration from schema changes (dev)
bun run db:seed    # seed demo data + bootstrap admin
```

## Deployment notes

**The canonical deployment is a single self-hosted Next.js app (Node or Bun) with SQLite and local-disk uploads.** The build produces a standalone server (`output: "standalone"`, `bun run start`). Nothing in this repo deploys to Cloudflare Workers as-is — see the migration path note at the end.

1. Provision Node 20+ / Bun 1.1+.
2. Set the environment variables (strong 32-byte secrets, `TOTP_ENC_KEY` — **mandatory, the server refuses to boot without it** — and a site URL; remember `NEXT_PUBLIC_SITE_URL` is baked in at BUILD time while the plain `SITE_URL` is read at RUNTIME and wins).
3. `bun install && bun run db:deploy && bun run db:seed && bun run build && bun run start` — run behind nginx/Caddy/Cloudflare and set the matching `TRUST_PROXY` value (matrix below). **A reverse proxy/CDN in front of the server is a production REQUIREMENT, not an option**: with direct exposure any client can forge a single-entry `x-forwarded-for` and rotate fresh rate-limit buckets (the server logs a boot warning while `TRUST_PROXY` is unset).
4. Place `db/custom.db` (and `db/ratelimit.db`) on a persistent volume — both are gitignored. **Back them up before every deploy.**

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
- Rate-limit writes live in their own SQLite file (`db/ratelimit.db`) and cannot contend with the checkout transaction.

### Known limitations (deliberate, documented)
- **Single instance only**: SQLite + the in-process checkout mutex are safe on exactly ONE server process. Multi-instance needs Postgres (the Prisma schema ports directly; the guarded `updateMany` calls become row locks) and a shared rate-limit store.
- **The rate-limit store is a local SQLite file** (`db/ratelimit.db`) — safe on one machine or one shared local volume. Multiple servers or a network-attached volume → replace the layer with Redis/KV (the `rateLimit(key, limit, window)` signature in `src/lib/rate-limit.ts` is kept for exactly that swap; the in-memory fallback is per-process only).
- **Supplier integration is a demo adapter** — no real dropshipping API is wired; writing a real `SupplierAdapter` + credentials is required.
- **Coupon per-customer limits for guests** are keyed on email + phone. A determined guest can dodge them by rotating both — inherent to anonymous checkout; the global usage limit still caps the damage.
- **Fixed-window rate limits** may allow ~2× a limit across a window boundary (accepted trade-off for cross-instance-correct counting).
- **bKash/Nagad verification is manual**: the TrxID is only the buyer's claim — the system cannot match amounts or sender numbers (no gateway API). The order page shows the expected amount + merchant number + TrxID in large type and requires an explicit SMS-match confirmation (`smsVerified`) before a payment can be marked Paid.

**Production hardening checklist**
- Run behind TLS; HSTS is enabled automatically in production builds.
- **Run behind a reverse proxy/CDN (Cloudflare/nginx/Caddy) and set the matching `TRUST_PROXY` value — REQUIRED** (matrix above). Direct exposure allows forged `x-forwarded-for` bucket rotation; the server warns at boot while `TRUST_PROXY` is unset.
- Configure `RESEND_API_KEY` for transactional mail (password reset requires it — tokens are redacted in the outbox by design; it also activates the guest-checkout email OTP for guests who give an email). If Resend has an outage the OTP gate relaxes automatically after 3 consecutive failed deliveries (round-5 breaker) — no env hand-editing, and no mail-bombing vector opens because nothing can be delivered during the outage.
- Set `TOTP_ENC_KEY` (openssl rand -hex 32) — **mandatory**: production boots are refused without it.
- Uploads live in `public/uploads` — mount a persistent volume, or port `src/lib/storage.ts` to S3/R2.
- **Scaling beyond one server**: move to Postgres + Redis for rate limiting; the checkout guards and rate-limit design already hold across instances sharing a database (see Known limitations).

**Cloudflare migration path** (future re-architecture, NOT the current deployment): split `src/app/(shop)` and `src/app/admin` into separate Pages/Workers apps, move `/api` route handlers into one shared Worker, replace SQLite with D1, the rate-limit store with KV, and `storage.ts` with an R2 binding. The raw SQL in `analytics.ts` is already plain SQLite.

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

Unit + integration tests: `bun run test` — password hashing/rehash detection, CSV/JSON-LD escaping, order status flow **+ TrxID release on cancel/return + PAID-before-release lock (round 5)**, TOTP RFC vectors + secret encryption (v1/v2 + rotation semantics) + replay, recovery-code generation/normalization/hashing, **guest-checkout email OTP (policy matrix + issue/consume/single-use/attempt-burn/expiry/supersede + ATOMIC attempt burning under concurrency + outbox redaction)**, **provider-outage breaker (trip / cooldown probe / re-trip / success-reset)**, email-gate policy matrix, SSRF guard, mail token redaction, and **checkout integration tests against a real SQLite database** (stock races up to 16 concurrent, variant races, coupon usage limits incl. guest email/phone identity, TrxID uniqueness under concurrency, post-commit failure isolation, **guest order without an email**).
