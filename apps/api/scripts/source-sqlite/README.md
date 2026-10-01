# source-sqlite — legacy SQLite migration toolkit

These scripts operate on the **legacy storefront SQLite database** (the
pre-Cloudflare monolith's `db/custom.db`) as part of the one-time migration
to Cloudflare D1. They use `bun:sqlite` directly — the Workers API itself
never opens SQLite files (it talks to D1), so this toolkit deliberately
lives apart from the app code.

## When to run what

| Order | Script | Purpose |
|---|---|---|
| 1 | `dedupe-reviews.ts` | Keep only the newest review per (product, customer) so the unique index holds after export |
| 2 | `check-trxid-duplicates.ts` | READ-ONLY report of duplicate `Payment.transactionId` values that the unique index would reject |
| 3 | `fix-product-images.ts` | Backfill `ProductImage` rows for products that lost their images to the manifest keying bug (also re-keys `image-manifest.json`) |
| 4 | `../export-to-d1.ts` | Emit the FK-ordered D1 INSERT chunks (see its header for the import commands) |
| 5 | `../migrate-media-to-r2.sh` | Upload `storefront/public/{products,banners,categories,uploads}` to R2 |

All accept an optional `[sqlite-path]` argument (default `db/custom.db`,
resolved from the monorepo root). Run them from the repo root with bun:

```bash
bun apps/api/scripts/source-sqlite/check-trxid-duplicates.ts db/custom.db
```

`fix-product-images.ts` verifies every manifest-referenced file exists on
disk under `apps/storefront/public` before touching the database, and only
ever INSERTs missing image rows — orders, reviews and tracking data are
never modified.
