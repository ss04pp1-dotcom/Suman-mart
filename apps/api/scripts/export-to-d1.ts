// Export the storefront's SQLite database to Cloudflare D1-compatible SQL.
//
// Usage (run from the monorepo root with bun):
//   bun apps/api/scripts/export-to-d1.ts [sqlite-path] [out-dir]
//
//   bun apps/api/scripts/export-to-d1.ts                      # db/custom.db → apps/api/export/
//   bun apps/api/scripts/export-to-d1.ts db/custom.db ./out   # explicit paths
//
// Then import into D1 (remote):
//   for f in apps/api/export/part-*.sql; do
//     wrangler d1 execute suman-mart --remote --file "$f"
//   done
//
// What it does:
//   • Emits INSERT statements for every user-data table, in an order that
//     satisfies foreign keys (parents before children), with
//     PRAGMA defer_foreign_keys as a belt-and-braces guard.
//   • CONVERTS DateTime columns from the Node/Prisma representation (epoch
//     milliseconds INTEGER) to the Prisma-D1-adapter representation
//     (ISO-8601 TEXT with +00:00) — without this, every date-range query on
//     the Workers API silently matches nothing (INTEGER vs TEXT comparison
//     in SQLite). Verified empirically during the Phase-8 port.
//   • Skips Prisma-internal tables (_prisma_migrations) and the local
//     rate-limit table (the Workers API keeps its own).
//   • Chunks output into ~500-statement files — well inside D1's
//     per-execute statement budget.
//   • Prints a per-table row-count report: use it to validate the import
//     (`SELECT COUNT(*) FROM "Order"` etc. on the remote D1).
//
// Rollback: D1 keeps automatic point-in-time snapshots — restore with
//   wrangler d1 restore suman-mart --remote <bookmark-or-timestamp>
// BEFORE the first production import, create a bookmark:
//   wrangler d1 time-travel info suman-mart --remote  (note the bookmark)
//
// This script NEVER deletes anything: it is a pure read + SQL emit.

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve(process.argv[2] ?? "db/custom.db");
const outDir = resolve(process.argv[3] ?? "apps/api/export");

if (!existsSync(dbPath)) {
  console.error(`[export-to-d1] database not found: ${dbPath}`);
  process.exit(1);
}

// Tables in FK-safe order (parents first). RateLimitEntry is intentionally
// absent: the Workers API provisions its own table via migration 0002.
const TABLES = [
  "Admin", "Customer", "Address",
  "Category", "Tag", "Supplier",
  "Product", "ProductImage", "ProductVariant", "ProductTag", "ProductRelation",
  "SupplierProduct", "SupplierSyncLog",
  "Coupon", "Banner", "HomepageSection",
  "Order", "OrderItem", "OrderStatusHistory", "Payment",
  "Review", "Setting",
  "TrackingSession", "TrackingEvent", "TrackingIntegration", "CookieConsent",
  "Notification", "AuditLog", "AuthToken", "GuestEmailOtp", "AdminRecoveryCode",
  "MailOutbox", "SequenceCounter", "SupplierOrder",
];

function quote(value: unknown): string | null {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (value instanceof Uint8Array) {
    // BLOBs are hex-encoded X'...' literals (SQLite + D1 compatible).
    return `X'${Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const db = new Database(dbPath, { readonly: true });
mkdirSync(outDir, { recursive: true });

const report: { table: string; rows: number }[] = [];
const statements: string[] = ["PRAGMA defer_foreign_keys = TRUE;"];

for (const table of TABLES) {
  const exists = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  if (!exists) {
    report.push({ table, rows: -1 }); // table not in this database — skip
    continue;
  }

  const tableInfo = db.query(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[];
  const columns = tableInfo.map((c) => c.name);
  // DateTime columns: the source DB stores epoch-millis INTEGERs (Node
  // Prisma); the D1 adapter expects ISO-8601 TEXT — convert on export.
  const dateColumns = new Set(tableInfo.filter((c) => c.type.toUpperCase() === "DATETIME").map((c) => c.name));
  const rows = db.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];

  for (const row of rows) {
    const values = columns.map((c) => {
      const value = row[c];
      if (dateColumns.has(c) && typeof value === "number") {
        return `'${new Date(value).toISOString().replace("Z", "+00:00")}'`;
      }
      return quote(value);
    });
    statements.push(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`);
  }
  report.push({ table, rows: rows.length });
}

// Chunk into files of ~500 statements (first file carries the PRAGMA header).
const CHUNK = 500;
let part = 0;
for (let i = 0; i < statements.length; i += CHUNK) {
  part += 1;
  const chunk = statements.slice(i, i + CHUNK);
  const file = resolve(outDir, `part-${String(part).padStart(3, "0")}.sql`);
  writeFileSync(file, chunk.join("\n") + "\n");
}

console.log(`[export-to-d1] wrote ${part} file(s) to ${outDir}`);
console.log("[export-to-d1] row counts (validate against D1 after import):");
for (const r of report) {
  console.log(`  ${r.rows >= 0 ? String(r.rows).padStart(6) : "  n/a"}  ${r.table}`);
}
console.log("[export-to-d1] import with:");
console.log(`  for f in ${outDir}/part-*.sql; do wrangler d1 execute suman-mart --remote --file "$f"; done`);
