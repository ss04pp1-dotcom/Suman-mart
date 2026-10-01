-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RateLimitEntry";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "AdminRecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminRecoveryCode_lookupHash_key" ON "AdminRecoveryCode"("lookupHash");

-- CreateIndex
CREATE INDEX "AdminRecoveryCode_adminId_idx" ON "AdminRecoveryCode"("adminId");

-- CreateIndex
-- Round-4 audit hardening: databases created BEFORE this migration could
-- legally hold duplicate/empty Payment.transactionId values (the column was
-- not unique). A bare CREATE UNIQUE INDEX would then make `migrate deploy`
-- FAIL on exactly the deployments that need this hardening. The index is
-- therefore preceded by a self-healing cleanup:
--   1. Empty strings are not distinct under a unique index (NULLs are) →
--      normalize '' to NULL.
--   2. Duplicate IDs: the OLDEST row (by createdAt, then rowid) keeps the
--      original ID; younger duplicates are renamed `<id>-DUP-<rowid>`
--      (rowid is unique per table, so the renamed value cannot collide).
--      These are historical bookkeeping rows only — manual-payment reuse is
--      enforced at checkout going forward.
-- Inspect your data first with: bun scripts/check-trxid-duplicates.ts
UPDATE "Payment" SET "transactionId" = NULL WHERE "transactionId" = '';

UPDATE "Payment"
SET "transactionId" = "transactionId" || '-DUP-' || "rowid"
WHERE "transactionId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Payment" older
    WHERE older."transactionId" = "Payment"."transactionId"
      AND (older."createdAt" < "Payment"."createdAt"
           OR (older."createdAt" = "Payment"."createdAt" AND older."rowid" < "Payment"."rowid"))
  );

CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");

