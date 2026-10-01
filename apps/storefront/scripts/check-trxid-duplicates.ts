// Pre-deploy diagnostic (round-4 audit): find duplicate / empty
// Payment.transactionId values that would collide with the unique index
// introduced by the round-3 migration.
//
// READ-ONLY — prints a report, changes nothing. Safe on production.
//
//   DATABASE_URL=file:./db/custom.db bun scripts/check-trxid-duplicates.ts
//
// The round-3 migration self-heals duplicates automatically (oldest row keeps
// the ID, younger ones are renamed `<id>-DUP-<rowid>`); run this BEFORE
// deploying so the rename never surprises you.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const REPO_ROOT = resolve(import.meta.dir, "..");
const url = process.env.DATABASE_URL ?? `file:${REPO_ROOT}/db/custom.db`;
const db = new PrismaClient({ datasources: { db: { url } } });

const rows = await db.$queryRaw<{ transactionId: string; n: bigint }[]>`
  SELECT "transactionId", COUNT(*) AS n
  FROM "Payment"
  WHERE "transactionId" IS NOT NULL
  GROUP BY "transactionId"
  HAVING COUNT(*) > 1
  ORDER BY n DESC
`;
const empty = await db.payment.count({ where: { transactionId: "" } });

if (rows.length === 0 && empty === 0) {
  console.log("OK — no duplicate or empty transactionIds. The unique-index migration is safe.");
} else {
  console.log(`DUPLICATES (${rows.length} IDs, ${rows.reduce((s, r) => s + Number(r.n) - 1, 0)} rows will be renamed by the migration):`);
  for (const r of rows) console.log(`  ${r.transactionId}  ×${r.n}`);
  if (empty > 0) console.log(`EMPTY STRINGS: ${empty} row(s) will be set to NULL by the migration.`);
  console.log("\nThe migration keeps the OLDEST row's ID and renames younger ones to <id>-DUP-<rowid>.");
}
await db.$disconnect();
