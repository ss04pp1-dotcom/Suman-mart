-- Unique restock claim token (Phase-8 port of restoreOrderStock).
--
-- The monolith claimed the restock inside a Prisma interactive transaction.
-- On D1 the claim + stock increments run as one atomic batch, and the
-- increments must be conditional on THIS batch's claim winning. Guarding by
-- stockRestoredAt alone admits a same-millisecond collision: two concurrent
-- restores with identical Date.now() tokens would both pass the equality
-- check and double-increment stock (an exactly-once violation).
--
-- The claim therefore also writes a crypto-random token; increments run only
-- when Order.stockRestoreToken equals THIS call's token. Collisions are
-- cryptographically impossible.

ALTER TABLE "Order" ADD COLUMN "stockRestoreToken" TEXT;
