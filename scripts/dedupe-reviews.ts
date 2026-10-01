/**
 * One-off migration helper: keep only the newest review per (productId, customerId)
 * so the @@unique([productId, customerId]) index can be created by `prisma db push`.
 * Safe to re-run. Guest reviews (customerId NULL) are untouched.
 *
 * Run: bun scripts/dedupe-reviews.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const result = await db.$executeRawUnsafe(`
    DELETE FROM Review
    WHERE customerId IS NOT NULL
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY productId, customerId
            ORDER BY createdAt DESC
          ) AS rn
          FROM Review
          WHERE customerId IS NOT NULL
        ) t WHERE t.rn = 1
      )
  `);
  const remaining = await db.review.count();
  console.log(`Removed ${result} duplicate review(s); ${remaining} remain.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
