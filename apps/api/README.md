# Suman Mart — Public REST API (Cloudflare Workers)

Versioned public read API (`api.example.com`): Hono on Cloudflare Workers with
**D1** (SQLite-compatible database) and **R2** (media). Contracts live in
`packages/shared` (`@suman-mart/shared`) so frontends and the API can never drift.

Current surface (strangler migration — see `docs/FEATURE-INVENTORY.md §8`):

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness + D1 check (503 when the DB is unreachable) |
| `GET /` | Self-documenting API index |
| `GET /v1/products` | Catalog list: `q`, `category`, `tag`, `minPrice`, `maxPrice`, `availability`, `featured`, `sort` (7 orders), `page`, `limit` (≤60) + tag facets |
| `GET /v1/products/:slug` | Detail: images, variants (parsed options), approved reviews, manual+auto related, FBT. `costPrice` is never exposed |
| `GET /v1/categories` | Active categories + active-product counts |
| `GET /v1/settings/public` | Public store settings (defaults merged with stored rows; secrets never leave) |
| `POST /v1/orders/track` | `{ orderNumber, phone }` — phone-matched tracking timeline (20 req/10 min per IP) |
| `GET /v1/media/*` | R2 media with immutable caching |

All responses share the platform envelope (`{success:true,data}` /
`{success:false,error,code?}`), are `Cache-Control: no-store` (media excepted),
and carry `X-API-Version` + baseline security headers. CORS is governed by
`ALLOWED_ORIGINS`.

## Develop & test (no Cloudflare account needed)

```bash
bunx wrangler d1 migrations apply suman-mart --local   # local D1 (miniflare)
bun run dev                                            # http://localhost:8787
bun run test                                           # 35 tests against real local D1 + R2
bun run typecheck
```

## Deploy

```bash
wrangler d1 create suman-mart             # put the id in wrangler.jsonc
wrangler r2 bucket create suman-mart-media
wrangler d1 migrations apply suman-mart --remote
bun run deploy
```

## Migrations

`migrations/0001_init.sql` is generated from the storefront's Prisma schema:

```bash
bunx prisma migrate diff --from-empty \
  --to-schema-datamodel ../storefront/prisma/schema.prisma --script
```

Regenerate and review whenever the schema changes. `0002` provisions the D1
rate-limit table (the API keeps its own limiter state).

## Data & media migration

- SQLite → D1: `bun scripts/export-to-d1.ts <db> <out-dir>` (FK-ordered INSERT
  chunks + row-count report; import with `wrangler d1 execute --remote --file`).
- Files → R2: `bash scripts/migrate-media-to-r2.sh [--local|--remote]`.

Rollback: create a D1 time-travel bookmark before importing; restore with
`wrangler d1 restore`.
