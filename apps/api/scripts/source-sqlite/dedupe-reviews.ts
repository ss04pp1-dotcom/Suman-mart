/**
 * One-off source-DB migration helper: keep only the newest review per
 * (productId, customerId) so the @@unique([productId, customerId]) index
 * holds after the export to D1. Safe to re-run. Guest reviews
 * (customerId NULL) are untouched.
 *
 *   bun apps/api/scripts/source-sqlite/dedupe-reviews.ts [sqlite-path]
 *
 * Part of the source-SQLite migration toolkit (see source-sqlite/README.md).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";

const dbPath = resolve(process.argv[2] ?? "db/custom.db");
if (!existsSync(dbPath)) {
  console.error(`[dedupe-reviews] database not found: ${dbPath}`);
  process.exit(1);
}
const db = new Database(dbPath);

const before = db.query<{ n: number }, null>(`SELECT COUNT(*) AS n FROM "Review"`).get()!.n;

const result = db.run(`
  DELETE FROM "Review"
  WHERE "customerId" IS NOT NULL
    AND "id" NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "productId", "customerId"
          ORDER BY "createdAt" DESC
        ) AS rn
        FROM "Review"
        WHERE "customerId" IS NOT NULL
      ) t WHERE t.rn = 1
    )
`);

const after = db.query<{ n: number }, null>(`SELECT COUNT(*) AS n FROM "Review"`).get()!.n;
console.log(`[dedupe-reviews] ${dbPath}: ${before} → ${after} rows (${before - after} duplicates removed, changes: ${result.changes})`);

const remaining = db
  .query<{ n: number }, null>(
    `SELECT COUNT(*) AS n FROM (
       SELECT "productId", "customerId" FROM "Review"
       WHERE "customerId" IS NOT NULL
       GROUP BY 1, 2 HAVING COUNT(*) > 1
     )`
  )
  .get()!.n;
console.log(`[dedupe-reviews] remaining (product, customer) pairs with >1 review: ${remaining}`);
db.close();
