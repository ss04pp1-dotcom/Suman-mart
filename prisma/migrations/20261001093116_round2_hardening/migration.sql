-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "totpLastStep" INTEGER;

-- CreateTable
CREATE TABLE "RateLimitEntry" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
