# ShopNest — Final Verification Report

**Scope**: the full FINAL EXECUTION PROMPT — update (not rebuild) the existing
platform into the target three-tier architecture, complete the backend,
connect every frontend workflow, remove mocks from production paths, verify
honestly, and deliver.

**Date**: 2026-10-02 · **Repo**: `ss04pp1-dotcom/Suman-mart` (main)

---

## 1. What was delivered

### Architecture (target reached)

| Tier | Stack | Role |
|---|---|---|
| `apps/storefront` | Next.js 16 standalone (Node/Bun) | Customer UI — pure proxy tier: `/api/*` → `${BACKEND_ORIGIN}/v1/*` at request time, RSC pages fetch `/v1/storefront/*` bundles, media proxies to `/v1/media/*`, edge middleware (nonce CSP + JWT pre-check). **Zero database access.** |
| `apps/admin` | Next.js 16 standalone (Node/Bun) | Admin console — same proxy pattern for `/api/admin/*`; shell layout session check via `/v1/admin/auth/me`. **Zero database access.** |
| `apps/api` | Cloudflare Workers (Hono) | **The entire backend**: versioned REST `/v1/*` (public, customer, admin surfaces), RSC data bundles, R2 media (read + write), D1 rate limiting, hourly cron (supplier sync, supplier-order retry, tracking retention). Prisma 6 client on the `@prisma/adapter-d1` adapter, workerd runtime. |
| `packages/shared` | TypeScript (edge-safe) | API contracts: envelope, zod schemas, `API_VERSION` — consumed by the API. |

### Backend completeness (61 route modules ported; every frontend workflow wired)

- **Customer**: register/login/logout/me/forgot/reset/verify-email; account
  profile + addresses CRUD + orders; cart validation (server-authoritative
  pricing); checkout (guest + signed-in, COD + bKash/Nagad manual TrxID, card
  hard-disabled by design); guest-email OTP with provider-outage auto-relax;
  order tracking (phone-matched); reviews; tracking ingestion (HMAC sessions,
  dedup, quotas, consent).
- **Admin**: auth (PBKDF2 + TOTP 2FA + recovery codes + lockouts + audit),
  dashboard KPIs, products (CRUD + bulk + 7-tab editor), categories, coupons,
  banners + homepage sections, review moderation, orders (status flow +
  payment verification with the server-enforced SMS-match tick + TrxID
  lock/release semantics), customers, team (RBAC, 5 roles + per-admin
  overrides), suppliers (sync/import/orders/retry), analytics (12 endpoints),
  9 CSV exports, settings (+ integration test), upload (R2), notifications,
  maintenance.
- **Transactional integrity on D1**: checkout is ONE atomic batch — guarded
  `INSERT..SELECT..WHERE` (stock/variants, coupon active+limit+per-customer,
  TrxID free) + conditional updates + sentinel abort; order-number counter via
  `UPDATE..RETURNING`; cancel/return stock-restore is exactly-once via a
  crypto `stockRestoreToken` guarded update.

### The flip (Phase 9, this session)

- Storefront dead monolith residue removed: 30 lib files, `prisma/`,
  generated clients, `db/`, prisma/sharp deps, stale env requirements
  (`DATABASE_URL`, `ADMIN_SESSION_SECRET` no longer demanded by a DB-less app).
- Admin flip completed: the last live Prisma chain (shell layout →
  `getCurrentAdmin`) now calls `/v1/admin/auth/me` through the new `apiGet`
  server helper; dead libs + prisma stack removed; legacy `/account` guard
  dropped from the admin middleware (no customer routes there).
- Pure-logic test suites moved to the API (password, recovery, totp,
  totp-security, url-guard, mailer, email-gate) with a `testEnv()` accessor
  for env-sensitive cases; SQLite-era integration suites superseded by the D1
  write-path suite.
- Source-SQLite migration toolkit relocated to `apps/api/scripts/source-sqlite/`
  (rewritten on `bun:sqlite`, no Prisma) + README.
- `ALLOWED_ORIGINS` default flipped to fail-closed `""`.
- E2E harness rewritten for the three-tier topology (below).

---

## 2. Verification matrix (all commands re-run for this report)

| Check | Result |
|---|---|
| `apps/api` typecheck (`tsc --noEmit`) | ✅ clean |
| `apps/storefront` typecheck | ✅ clean |
| `apps/admin` typecheck | ✅ clean |
| `apps/api` tests (vitest, real local D1 + R2 under workerd; run in 5 batches for sandbox memory) | ✅ **103/103** — 8 original files (public surface, write-paths incl. 8-way race → exactly-5-sold / no oversell, cancel → exactly-once restore, admin RBAC/CRUD/analytics/CSV/upload-validation/last-super-admin) + 7 ported pure-logic files |
| `apps/storefront` unit tests | ✅ 8/8 (escaping) |
| ESLint (both UI apps) | ✅ 0 errors (pre-existing warnings documented) |
| `apps/storefront` production build (standalone, `ignoreBuildErrors: false`) | ✅ |
| `apps/admin` production build (standalone) | ✅ |
| **E2E journeys** (production trio on one boot: wrangler-dev API :8787 + storefront :3111 + admin :3112, `tests/e2e/journeys.ts`) | ✅ **49/49** — customer browse→search→detail→R2 image→cart→guest COD checkout (WELCOME10)→order-success→tracking→register→account overview/orders/addresses; admin login through the admin proxy→/me→dashboard→orders→SMS-guard (manual payments only)→COD mark-received→PNG upload→R2 serve-back→analytics→customers→coupons→settings→suppliers; TrxID dup 409; cross-origin CSRF 403; unauthenticated /admin → login redirect |
| **E2E round5** (same topology, `tests/e2e/round5.ts`, simulated Resend outage) | ✅ **38/38** — honest `sent:false`, outbox FAILED rows, OTP-gated order during outage, breaker auto-relax after 3 failures, public flag flips, optional guest email (no mail attempted), PAID+CANCELLED keeps TrxID locked, plain cancel releases it (`-RELEASED-` rename) and the ID funds a new order, `payment.sms_verified` audit row with operator/TrxID/amount/time, shipped UI copy checks |
| Cron / scheduled handler | ✅ implemented + mounted (`0 * * * *`: supplier sync, retry failed supplier orders, tracking retention); exercised in unit coverage of the underlying jobs |
| Media pipeline | ✅ dev-seed uploads → R2; served via `/v1/media/*` through both UI proxies; admin upload endpoint writes R2 (E2E-verified — pool-workers cannot isolate R2 writes, documented) |

### Bugs found by the new E2E suite (and fixed)

1. **All 6 storefront account pages called the RSC fetch without forwarding
   the session cookie** — every `/account/*` page bounced to `/login` even
   for valid sessions. Fixed: `headers()` cookie forwarded through `apiGet`
   (layout, profile, addresses, wishlist, orders, order detail).
2. **dev-seed re-runs collided** on UNIQUE constraints (DELETE list missed
   `HomepageSection`/`Banner`/`SupplierSyncLog`/`RateLimitEntry`). Fixed.
3. **E2E helper shell-expansion bug** (found during bring-up): SQL passed
   through a double-quoted shell string silently corrupted PBKDF2 hashes
   (`$600000` expanded). Fixed with array-spawn; documented in the helper.
4. **`ALLOWED_ORIGINS: "*"` default disabled the CSRF check** — flipped to
   fail-closed `""` (proxies are same-origin; direct-browser consumers must
   be listed).

---

## 3. Honest inventory of what is NOT done (external activation required)

Nothing in the codebase is a stub, TODO, placeholder handler, fake success
response, or dead button. The remaining items all require **external
credentials or accounts** that cannot be invented:

| Item | State | Activation step |
|---|---|---|
| Real Cloudflare deploy (`wrangler deploy`, remote D1/R2) | Config complete; local emulation verified end-to-end | Cloudflare account → `wrangler login` → follow `docs/DEPLOYMENT.md` |
| Resend transactional email | Code complete (outbox + redaction + outage breaker verified) | `wrangler secret put RESEND_API_KEY` |
| Meta Pixel + Conversions API, GA4 + MP, GTM, Google Ads, TikTok + Events API | Code complete; admin Settings UI ready; event dedup + consent enforcement verified | enter real IDs/tokens in Admin → Settings → Tracking |
| bKash / Nagad automated gateway | Manual verification flow complete + audited (deliberate: no gateway API) | merchant API credentials → extend `lib/checkout.ts` + settings |
| Real dropshipping supplier | Adapter interface + sync/import/orders/retry engine real; **demo adapter only** (clearly labelled in code + UI) | supplier API docs → implement `SupplierAdapter` |
| Card payments | Hard-disabled by design | gateway credentials |
| Production domain secrets | Templates + fail-fast validation in place | generate + set per `docs/DEPLOYMENT.md` |

### Known limitations (documented, deliberate)

See README → "Known limitations": supplier demo adapter; guest coupon identity
rotation; fixed-window ~2× boundary burst; no sharp re-encode on Workers
(uploads stored byte-exact after validation, SVG banned); single D1 primary.

---

## 4. How to re-verify locally

```bash
bun install
bun run test                      # API 103 (batched) + storefront 8
bun run typecheck                 # all three apps
bun run build && bun run build:admin
cd apps/storefront
E2E_BOOT=1 bash tests/e2e/boot.sh        # boots the production trio
E2E_JOURNEYS=1 bun tests/e2e/journeys.ts  # 49 checks
E2E_ROUND5=1 bun tests/e2e/round5.ts      # 38 checks (run right after boot)
```

Test-by-test evidence lives in the repo history (worklog.md documents every
phase; the QA table in README.md carries the full five-round audit trail).
