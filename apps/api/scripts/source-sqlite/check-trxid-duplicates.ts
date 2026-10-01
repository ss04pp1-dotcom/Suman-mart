// Pre-export diagnostic (round-4 audit): find duplicate / empty
// Payment.transactionId values that would collide with the unique index
// in the D1 migrations.
//
// READ-ONLY — prints a report, changes nothing. Safe on production data.
//
//   bun apps/api/scripts/source-sqlite/check-trxid-duplicates.ts [sqlite-path]
//
// The round-3 migration self-heals duplicates automatically (oldest row keeps
// the ID, younger ones are renamed `<id>-DUP-<rowid>`); run this BEFORE
// running export-to-d1 so the rename never surprises you.
//
// Part of the source-SQLite migration toolkit (see source-sqlite/README.md):
// these scripts operate on the LEGACY storefront SQLite database — the kind
// of access the Workers API itself never performs (it talks to D1).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";

const dbPath = resolve(process.argv[2] ?? "db/custom.db");
if (!existsSync(dbPath)) {
  console.error(`[check-trxid] database not found: ${dbPath}`);
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });

const dupes = db
  .query<{ transactionId: string; n: number }, null>(
    `SELECT "transactionId", COUNT(*) AS n
     FROM "Payment"
     WHERE "transactionId" IS NOT NULL
     GROUP BY "transactionId"
     HAVING COUNT(*) > 1
     ORDER BY n DESC, "transactionId"`
  )
  .all();

const empty = db
  .query<{ n: number }, null>(
    `SELECT COUNT(*) AS n FROM "Payment" WHERE "transactionId" = ''`
  )
  .get()!;

console.log(`[check-trxid] database: ${dbPath}`);
console.log(
  dupes.length === 0
    ? "[check-trxid] OK — no duplicate transactionIds"
    : `[check-trxid] ${dupes.length} duplicated transactionId(s):`
);
for (const row of dupes) console.log(`  ${row.transactionId}  ×${row.n}`);
if (empty.n > 0) console.log(`[check-trxid] WARNING: ${empty.n} payment row(s) with empty-string transactionId`);
db.close();
