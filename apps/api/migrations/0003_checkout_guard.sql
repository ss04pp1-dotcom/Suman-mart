-- Checkout abort sentinel (Phase-8 port of the checkout transaction to D1).
--
-- The monolith ran the whole order inside one Prisma interactive transaction
-- on SQLite; the D1 driver adapter does not support interactive transactions,
-- so apps/api/src/lib/checkout.ts runs ONE atomic D1 batch instead. Batches
-- roll back only when a statement ERRORS — row-count guards alone cannot
-- abort them. This tiny table provides the abort mechanism:
--
--   INSERT INTO "CheckoutGuard" ("key") SELECT NULL WHERE <guard failed>
--
-- When the guard holds, the SELECT yields no row and nothing is inserted.
-- When it fails, the insert tries to write NULL into a NOT NULL column →
-- constraint error → the WHOLE batch rolls back (no stock/coupon side
-- effects), and the route re-validates the cart to report which line failed.
--
-- The table is intentionally permanent (it must exist in every environment);
-- successful checkouts never leave rows in it.

CREATE TABLE "CheckoutGuard" (
    "key" TEXT NOT NULL PRIMARY KEY
);
