# ShopNest — Deployment Guide (three-tier architecture)

Target topology:

```
        ┌──────────────────┐        ┌──────────────────┐
        │  storefront      │        │  admin app       │
        │  Next.js (Node)  │        │  Next.js (Node)  │
        │  shop.example.com│        │  admin.example.com
        └────────┬─────────┘        └────────┬─────────┘
                 │  /api/* → /v1/* (runtime proxy)  │
                 ▼                             ▼
        ┌────────────────────────────────────────────┐
        │  Workers API  (api.example.com)            │
        │  Hono · /v1/* · /health · hourly cron      │
        │  D1 (data) · R2 (media) · secrets          │
        └────────────────────────────────────────────┘
```

Both UI tiers are stateless (no database, no volumes). The Workers API owns
every request's authority. Deploy the API first.

---

## A. Workers API — Cloudflare

### 1. Provision resources (one-time)

```bash
cd apps/api
bun install                                # runs prisma generate + the wasm patch
bunx wrangler login

bunx wrangler d1 create suman-mart
# → copy the returned database_id into wrangler.jsonc → d1_databases[0].database_id

bunx wrangler r2 bucket create suman-mart-media
# → the bucket binding name in wrangler.jsonc is MEDIA; the bucket name is
#   configured in the R2 buckets section — keep them aligned
```

### 2. Configure environment

`wrangler.jsonc`:

- `vars.ALLOWED_ORIGINS` — comma-separated origins allowed to call the API
  directly from a browser. The storefront/admin proxies are same-origin and
  need NOTHING here; keep the fail-closed default `""` unless you have
  direct-browser consumers (e.g. a mobile app).
- `vars.ENVIRONMENT` — `"production"` (drives NODE_ENV, absent-Origin CSRF
  strictness, dev-only serializers).
- `crons` — already registered (`0 * * * *`): supplier sync + supplier-order
  retry + tracking retention.

Secrets (NEVER in wrangler.jsonc — use `wrangler secret put`):

```bash
bunx wrangler secret put SESSION_SECRET        # openssl rand -hex 32
bunx wrangler secret put ADMIN_SESSION_SECRET  # openssl rand -hex 32
bunx wrangler secret put TOTP_ENC_KEY          # openssl rand -hex 32
bunx wrangler secret put TRUST_PROXY           # "cf" (API fronted by Cloudflare) or "1"
# optional:
bunx wrangler secret put RESEND_API_KEY        # transactional mail
bunx wrangler secret put MAIL_FROM             # "ShopNest <no-reply@shopnest.com>"
bunx wrangler secret put SITE_URL              # https://shop.example.com (emailed links)
```

Record `SESSION_SECRET` and `ADMIN_SESSION_SECRET` — the storefront and admin
app need the SAME values (their edge middleware pre-verify JWTs locally; the
API re-verifies every request against the database).

### 3. Migrate data

**Fresh install** (no legacy data):

```bash
bunx wrangler d1 migrations apply suman-mart --remote
# seed what you need through the API or adapt apps/api/scripts/dev-seed.mjs
```

**From the legacy SQLite monolith** (order matters — see
`apps/api/scripts/source-sqlite/README.md`):

```bash
# 0. safety net first
bunx wrangler d1 time-travel info suman-mart --remote     # note the bookmark
# 1. clean + inspect the SOURCE database (read-only except dedupe)
bun apps/api/scripts/source-sqlite/dedupe-reviews.ts db/custom.db
bun apps/api/scripts/source-sqlite/check-trxid-duplicates.ts db/custom.db
bun apps/api/scripts/source-sqlite/fix-product-images.ts db/custom.db   # if the manifest bug applies
# 2. export (FK-ordered INSERT chunks; converts DateTime epoch-millis → ISO-8601 TEXT)
bun apps/api/scripts/export-to-d1.ts db/custom.db apps/api/export
# 3. import
for f in apps/api/export/part-*.sql; do
  bunx wrangler d1 execute suman-mart --remote --file "$f"
done
# 4. validate against the printed per-table row counts, e.g.
bunx wrangler d1 execute suman-mart --remote --command 'SELECT COUNT(*) FROM "Order"'
# 5. media → R2
bash apps/api/scripts/migrate-media-to-r2.sh --remote
```

Rollback for data = D1 time-travel restore; for code = `wrangler deployments
rollback`. Neither migration tool ever deletes or mutates the source files.

### 4. Deploy + verify

```bash
cd apps/api && bun run deploy
curl -fsS https://api.example.com/health     # {"status":"ok",...,"db":"connected"}
```

---

## B. Storefront — any Node 20+/Bun host

```bash
cd apps/storefront
bun install
NEXT_PUBLIC_SITE_URL=https://shop.example.com bun run build
BACKEND_ORIGIN=https://api.example.com \
SESSION_SECRET=<same as the API's> \
NODE_ENV=production \
bun .next/standalone/apps/storefront/server.js     # behind nginx/Caddy/Cloudflare + TLS
```

- No database, no volumes, no other secrets — scale horizontally freely.
- `BACKEND_ORIGIN` is read at REQUEST time (one build targets any environment).
- The standalone server path is nested because of the bun workspace layout
  (the build script copies `static/` + `public/` into place for you).
- Docker/PM2/systemd: run the standalone server as you would any Node app.

## C. Admin app — any Node 20+/Bun host

```bash
cd apps/admin
bun install
NEXT_PUBLIC_SITE_URL=https://admin.example.com bun run build
BACKEND_ORIGIN=https://api.example.com \
ADMIN_SESSION_SECRET=<same as the API's> \
NODE_ENV=production \
bun .next/standalone/apps/admin/server.js          # behind TLS
```

Same properties as the storefront: stateless, no database, horizontally
scalable. `/admin/*` is guarded by the edge middleware (JWT pre-check) and the
shell layout's session check (`/v1/admin/auth/me`).

---

## Operations runbook

| Task | Command |
|---|---|
| Deploy API | `cd apps/api && bun run deploy` |
| Rollback API code | `bunx wrangler deployments rollback` |
| Apply new D1 migration | `bun run db:migrate:remote` (from repo root) |
| D1 backup bookmark | `bunx wrangler d1 time-travel info suman-mart --remote` |
| D1 restore | `bunx wrangler d1 restore suman-mart --remote <bookmark>` |
| Rotate a secret | `bunx wrangler secret put NAME` → redeploy UI apps only if it is a session secret they mirror |
| Rotate SESSION_SECRET | update API + storefront together (mismatch = login loop); customers re-login |
| Rotate TOTP_ENC_KEY | API only; affected admins re-enroll 2FA (recovery codes keep working) |
| Tail API logs | `bunx wrangler tail` |
| Local E2E against the trio | `apps/storefront/tests/e2e/boot.sh` then the drivers (see README → Scripts) |

## Post-deploy checklist

- [ ] `GET https://api.example.com/health` → `db: connected`
- [ ] Storefront home renders; product pages show R2 images
- [ ] Guest COD checkout end-to-end (order number issued)
- [ ] Admin login → dashboard → orders (through the admin app's own host)
- [ ] `RESEND_API_KEY` set if transactional mail is wanted (password reset
      requires it; guest-email OTP activates automatically)
- [ ] Tracking pixels configured in Admin → Settings → Tracking (IDs are
      per-environment; secrets never leave the API)
