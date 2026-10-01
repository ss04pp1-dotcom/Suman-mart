-- Rate limiting for the Workers API (D1-backed fixed windows).
-- Ported from the monolith's dedicated limiter (prisma/ratelimit/schema.prisma).
-- Everything shares the one D1 database on this service — the checkout
-- write-path does not run here (see docs/FEATURE-INVENTORY.md §8).

CREATE TABLE "RateLimitEntry" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" INTEGER NOT NULL
);
