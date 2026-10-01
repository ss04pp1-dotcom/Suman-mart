import { PrismaClient } from "@/generated/ratelimit";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Prisma client for the DEDICATED rate-limit database (db/ratelimit.db).
//
// Separate from the main store database on purpose: rate-limit writes used
// to contend with the checkout transaction for SQLite's single write lock
// (round-3 audit). With its own file the limiter has its own lock domain —
// a busy limiter can never add latency to checkout.
//
// The URL can be overridden with RATELIMIT_DATABASE_URL; the default is
// resolved to an ABSOLUTE path (relative SQLite paths are ambiguous across
// the standalone build / test runner working directories).
//
// The single table is created lazily on first use — this database has no
// migration story and none is needed.
// ─────────────────────────────────────────────────────────────────────────

const globalForRl = globalThis as unknown as {
  rlPrisma: PrismaClient | undefined;
  rlReady: Promise<PrismaClient> | undefined;
};

function createClient(): PrismaClient {
  const url =
    process.env.RATELIMIT_DATABASE_URL ??
    `file:${path.resolve(process.cwd(), "db/ratelimit.db")}`;
  return new PrismaClient({
    datasources: { ratelimit: { url } },
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error"],
  });
}

/** Lazily-created singleton client with the bucket table ensured. */
export function rateLimitDb(): Promise<PrismaClient> {
  if (!globalForRl.rlReady) {
    globalForRl.rlReady = (async () => {
      const client = globalForRl.rlPrisma ?? createClient();
      globalForRl.rlPrisma = client;
      await client.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "RateLimitEntry" (
           "key" TEXT NOT NULL PRIMARY KEY,
           "count" INTEGER NOT NULL DEFAULT 0,
           "windowStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      );
      return client;
    })().catch((e) => {
      // Reset so a later request can retry initialization.
      globalForRl.rlReady = undefined;
      throw e;
    });
  }
  return globalForRl.rlReady;
}
