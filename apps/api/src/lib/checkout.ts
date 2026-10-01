// Checkout business logic — D1 port of apps/storefront src/lib/checkout.ts.
//
// Prices, stock, coupons and shipping are ALWAYS validated server-side — the
// client cart is treated as untrusted input (unchanged).
//
// Concurrency model (createOrder) — REDESIGNED for D1:
// The monolith used ONE Prisma interactive transaction; the D1 adapter does
// not support interactive transactions, so the critical section is ONE
// `env.DB.batch([...])` — D1 batches execute as a single SQL transaction
// (atomic: any statement error rolls back everything). Guarded writes work
// like this inside the batch:
//
//   1. the ORDER row is inserted by an `INSERT ... SELECT ... WHERE <guards>`
//      — the guards (stock >= qty per line, variant stock, coupon active +
//      usageLimit, coupon per-customer usage count) all run as subqueries in
//      the INSERT's WHERE, i.e. atomically WITH the insert;
//   2. every other write (stock decrement, coupon increment, order items,
//      status history, payment, supplier orders) is conditional on
//      `EXISTS (SELECT 1 FROM "Order" WHERE id = ?)` — when the guard
//      failed and the order was not inserted, they all no-op;
//   3. the FINAL statement inserts NULL into the CheckoutGuard sentinel iff
//      the order row is missing → NOT NULL constraint error → the whole
//      batch rolls back cleanly (no partial state, no oversell).
//
// The order number still comes from an atomic counter
// (UPDATE SequenceCounter ... RETURNING); the Order INSERT reads the updated
// counter value in-batch via a subselect (statements in a batch see the
// effects of earlier statements — same transaction).
//
// Per-line/per-customer guards that fail produce a generic batch error; the
// route then re-validates the cart to surface WHICH line failed (the data
// was rolled back, so the re-check is authoritative).

import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { sqlDate } from "@/lib/config";
import { stringifyJSON, parseJSON } from "@/lib/json";
import { notify } from "@/lib/notifications";
import { processPendingSupplierOrders } from "@/lib/suppliers/orders";
import { recordServerEvent } from "@/lib/tracking";
import { orderConfirmationMail, sendMail } from "@/lib/mailer";

// ─────────────────────────────────────────────────────────────────────────

export interface CartLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface ValidatedLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  total: number;
  options: Record<string, string> | null;
  stock: number;
  supplierId: string | null;
}

export interface CouponResult {
  ok: boolean;
  reason?: string;
  discount: number;
  freeShipping: boolean;
  coupon: {
    id: string;
    code: string;
    type: string;
    value: number;
    maxDiscount: number | null;
    usageLimit: number | null;
    perCustomerLimit: number | null;
  } | null;
}

/** Error carrying a customer-friendly message out of the batch. */
export class CheckoutError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "CheckoutError";
    this.status = status;
  }
}

const MAX_CART_LINES = 50;

export async function validateCart(items: CartLineInput[]): Promise<{ lines: ValidatedLine[]; errors: string[] }> {
  const lines: ValidatedLine[] = [];
  const errors: string[] = [];
  if (items.length > MAX_CART_LINES) return { lines: [], errors: ["Your cart has too many distinct items."] };

  // Batched lookups (2 queries regardless of cart size — no N+1)
  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = [...new Set(items.filter((i) => i.variantId).map((i) => i.variantId as string))];
  const [products, variantRows] = await Promise.all([
    db.product.findMany({
      where: { id: { in: productIds } },
      include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, supplierProduct: true },
    }),
    variantIds.length ? db.productVariant.findMany({ where: { id: { in: variantIds } } }) : Promise.resolve([]),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variantRows.map((v) => [v.id, v]));

  // Track remaining stock while walking the lines so the SAME product split
  // across multiple lines cannot collectively oversell.
  const remainingStock = new Map<string, number>();

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || !product.isActive) {
      errors.push(`A product in your cart is no longer available.`);
      continue;
    }

    let unitPrice = product.price;
    let variantSku = product.sku;
    let variantStock = product.stock;
    let options: Record<string, string> | null = null;
    let variantName = "";

    if (item.variantId) {
      const variant = variantMap.get(item.variantId);
      if (!variant || variant.productId !== product.id) {
        errors.push(`The selected option for ${product.name} is no longer available.`);
        continue;
      }
      unitPrice = variant.price ?? product.price;
      variantSku = variant.sku ?? product.sku;
      variantStock = variant.stock;
      options = parseJSON<Record<string, string>>(variant.options, {});
      variantName = variant.name;
    }

    const stockKey = item.variantId ?? product.id;
    const available = remainingStock.get(stockKey) ?? variantStock;
    if (available < item.quantity) {
      errors.push(
        available > 0
          ? `Only ${available} left in stock for ${product.name}${variantName ? ` (${variantName})` : ""}.`
          : `${product.name}${variantName ? ` (${variantName})` : ""} is out of stock.`
      );
      continue;
    }
    remainingStock.set(stockKey, available - item.quantity);

    lines.push({
      productId: product.id,
      variantId: item.variantId ?? null,
      name: product.name,
      sku: variantSku,
      imageUrl: product.images[0]?.url ?? null,
      unitPrice,
      quantity: item.quantity,
      total: unitPrice * item.quantity,
      options,
      stock: variantStock,
      supplierId: product.supplierProduct?.supplierId ?? null,
    });
  }

  return { lines, errors };
}

/**
 * How many non-cancelled orders already used the coupon by THIS identity —
 * logged-in customers are identified by account, guests by email AND phone
 * (the shipping phone is mandatory, so guests cannot dodge the limit either).
 */
async function couponUsesByIdentity(
  couponCode: string,
  identity: { customerId?: string | null; email?: string | null; phone?: string | null }
): Promise<number> {
  const OR: Record<string, unknown>[] = [];
  if (identity.customerId) OR.push({ customerId: identity.customerId });
  if (identity.email) OR.push({ customerEmail: identity.email.toLowerCase() });
  if (identity.phone) OR.push({ customerPhone: identity.phone });
  if (OR.length === 0) return 0;
  return db.order.count({
    where: { OR, couponCode, status: { not: "CANCELLED" } },
  });
}

export interface CouponIdentity {
  customerId: string | null;
  email?: string | null;
  phone?: string | null;
}

export async function validateCoupon(
  code: string,
  subtotal: number,
  lines: ValidatedLine[],
  identity: CouponIdentity
): Promise<CouponResult> {
  const invalid = (reason: string): CouponResult => ({ ok: false, reason, discount: 0, freeShipping: false, coupon: null });
  const coupon = await db.coupon.findUnique({ where: { code: code.toUpperCase().trim() } });
  if (!coupon || !coupon.isActive) return invalid("Invalid coupon code");

  const now = new Date();
  if (coupon.startsAt > now) return invalid("This coupon is not active yet");
  if (coupon.expiresAt && coupon.expiresAt < now) return invalid("This coupon has expired");
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return invalid("This coupon has reached its usage limit");
  if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount)
    return invalid(`Minimum order of ৳${coupon.minOrderAmount.toLocaleString()} required`);

  // Per-customer usage limit — guests are tracked by email/phone
  if (coupon.perCustomerLimit && coupon.perCustomerLimit > 0) {
    const used = await couponUsesByIdentity(coupon.code, identity);
    if (used >= coupon.perCustomerLimit) return invalid("You have already used this coupon the maximum number of times");
  }

  // Product / category / customer scoping
  if (coupon.productId) {
    const eligible = lines.some((l) => l.productId === coupon.productId);
    if (!eligible) return invalid("Coupon does not apply to items in your cart");
  }
  if (coupon.categoryId) {
    const products = await db.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) }, categoryId: coupon.categoryId },
      select: { id: true },
    });
    if (products.length === 0) return invalid("Coupon does not apply to items in your cart");
  }
  if (coupon.customerId && coupon.customerId !== identity.customerId) return invalid("This coupon is not available for your account");

  if (coupon.type === "FREE_SHIPPING") {
    return {
      ok: true,
      discount: 0,
      freeShipping: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount,
        usageLimit: coupon.usageLimit,
        perCustomerLimit: coupon.perCustomerLimit,
      },
    };
  }

  let discount = 0;
  if (coupon.type === "PERCENTAGE") {
    discount = Math.floor((subtotal * coupon.value) / 100);
    if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    discount = Math.min(coupon.value, subtotal);
  }

  return {
    ok: true,
    discount,
    freeShipping: false,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      maxDiscount: coupon.maxDiscount,
      usageLimit: coupon.usageLimit,
      perCustomerLimit: coupon.perCustomerLimit,
    },
  };
}

export interface CreateOrderInput {
  lines: ValidatedLine[];
  couponResult: CouponResult | null;
  address: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string | null;
    city: string;
    area?: string | null;
    postalCode?: string | null;
  };
  paymentMethod: string;
  /** Transaction reference for manually-verified mobile payments (bKash/Nagad). */
  paymentTrxId?: string | null;
  customerId: string | null;
  customerEmail?: string | null;
  customerNote?: string | null;
  sessionKey?: string | null;
  requestHeaders?: Headers;
  /** Workers-native post-response scheduler (c.executionCtx.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Human-readable payment labels for customer-facing mail/UI copy. */
export function paymentLabel(method: string): string {
  switch (method) {
    case "COD":
      return "cash on delivery";
    case "BKASH":
      return "bKash — payment verification pending";
    case "NAGAD":
      return "Nagad — payment verification pending";
    default:
      return method.toLowerCase();
  }
}

// ── ID generation (cuid-compatible with the existing data) ───────────

let idCounter = 0;
function cuidLike(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616; // 36^4
  const time = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  return `c${time}${rand}${idCounter.toString(36).padStart(4, "0")}${prefix}`;
}

/**
 * Ensure the order-number counter row exists. Same bootstrap as the monolith:
 * initialised from the highest existing order number; the actual increment is
 * an atomic UPDATE … RETURNING inside the batch.
 */
async function ensureOrderCounter(): Promise<void> {
  const existing = await db.sequenceCounter.findUnique({ where: { key: "order" } });
  if (existing) return;
  const last = await db.order.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
  const lastSeq = last ? parseInt(last.orderNumber.replace(/\D/g, ""), 10) : 100000;
  const init = Number.isFinite(lastSeq) && lastSeq >= 100000 ? lastSeq : 100000;
  // INSERT OR IGNORE: idempotent under concurrent initializers (Prisma's
  // upsert is select-then-insert and races with a UNIQUE violation).
  await (await d1())
    .prepare(`INSERT OR IGNORE INTO "SequenceCounter" ("key", "value") VALUES ('order', ?1)`)
    .bind(init)
    .run()
    .catch(() => undefined);
}

/** SQL identifier quoting helper for values we build statements from. */
function bindable(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return String(value);
}

// ── Concurrency control (ported from the monolith) ───────────────────
// SQLite/D1 serialize writes at the database level; when several checkouts
// race, the losers wait on the write lock. The monolith used an in-process
// write mutex + transient-error retry for exactly this (its local SQLite
// could deadlock the same way local D1 does under parallel transactions):
//   1. an in-isolate write mutex so concurrent checkouts take turns cleanly
//   2. a retry for transient D1 write-contention errors ("database is
//      locked" / SQLITE_BUSY) for the multi-isolate production case
let checkoutWriteChain: Promise<unknown> = Promise.resolve();

function serializeCheckoutWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = checkoutWriteChain.then(fn, fn);
  checkoutWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Serialize a whole checkout critical-section (cart reads → atomic batch).
 *
 * Why the READS are included: the LOCAL dev/test D1 (workerd miniflare)
 * executes on a single SQLite connection and cannot run queries concurrently
 * with an open batch transaction — a parallel read during another request's
 * batch deadlocks until the runtime's hang detector fires. Real Cloudflare D1
 * uses WAL + server-side write queuing and does not have this constraint;
 * the serializer is still correct there (it just reduces same-isolate
 * contention). The monolith had the same in-process mutex for its local
 * SQLite deployment.
 */
export function serializeCheckoutSection<T>(fn: () => Promise<T>): Promise<T> {
  return serializeCheckoutWrite(fn);
}

function isTransientD1Error(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  return /database is locked|SQLITE_BUSY|busy timeout/i.test(message);
}

export async function createOrder(input: CreateOrderInput) {
  const shippingSettings = await getSetting("shipping");
  const subtotal = input.lines.reduce((sum, l) => sum + l.total, 0);
  const discount = input.couponResult?.discount ?? 0;
  const freeShipping =
    input.couponResult?.freeShipping || (shippingSettings.freeShippingThreshold > 0 && subtotal - discount >= shippingSettings.freeShippingThreshold);
  const shippingTotal = freeShipping ? 0 : shippingSettings.flatRate;
  const codCharge = input.paymentMethod === "COD" ? shippingSettings.codCharge : 0;
  const total = subtotal - discount + shippingTotal + codCharge;

  const estimatedDays = shippingSettings.estimatedDaysMin + Math.floor(Math.random() * Math.max(1, shippingSettings.estimatedDaysMax - shippingSettings.estimatedDaysMin + 1));
  const estimatedDelivery = new Date(Date.now() + estimatedDays * 86400_000);

  await ensureOrderCounter();

  // ── Pre-batch reads (advisory; the authoritative guards live in the batch) ──
  const coupon = input.couponResult?.coupon ?? null;
  const dropshipLines = input.lines.filter((l) => l.supplierId);
  const supplierGroups = new Map<string, ValidatedLine[]>();
  for (const line of dropshipLines) {
    const group = supplierGroups.get(line.supplierId as string) ?? [];
    group.push(line);
    supplierGroups.set(line.supplierId as string, group);
  }
  const suppliers = dropshipLines.length
    ? await db.supplier.findMany({ where: { id: { in: [...supplierGroups.keys()] }, isActive: true }, select: { id: true } })
    : [];
  const activeSupplierIds = new Set(suppliers.map((s) => s.id));

  // ── The atomic batch ────────────────────────────────────────────────
  const orderId = cuidLike("k");
  const itemId = (i: number) => cuidLike(`i${i}`);
  const historyId = cuidLike("h");
  const paymentId = cuidLike("p");
  const supplierOrderIds = new Map<string, string>();
  for (const supplierId of supplierGroups.keys()) {
    if (activeSupplierIds.has(supplierId)) supplierOrderIds.set(supplierId, cuidLike("s"));
  }

  const now = Date.now();
  // DateTime columns are stored as ISO-8601 TEXT (+00:00) — the Prisma D1
  // adapter's representation (see lib/config.ts sqlDate).
  const d = (ms: number) => sqlDate(ms);

  const statements: D1PreparedStatement[] = [];

  // 1. Atomic order-number counter (read back from this statement's results)
  statements.push(
    (await d1()).prepare(`UPDATE "SequenceCounter" SET "value" = "value" + 1 WHERE "key" = 'order' RETURNING "value"`)
  );

  // 2. Guarded ORDER insert — every guard runs in the WHERE clause:
  //    • per-line product stock + active  (via json_each over ONE bound
  //      payload — D1 caps bound parameters per statement at 100, and a
  //      50-line cart with per-line EXISTS guards would exceed it)
  //    • per-line variant stock (when applicable, same payload)
  //    • coupon still active + under its global usage limit
  //    • coupon per-customer usage count (identity-matched, non-cancelled)
  //    • TrxID still free (unique index is the final backstop; this makes the
  //      guard explicit so the diagnostic message can mention it)
  const guardParts: string[] = [];
  const guardBinds: unknown[] = [];
  let b = 0;
  const ph = () => `?${++b}`;

  // ONE JSON payload carries every line (id / variant / qty).
  const linePayload = JSON.stringify(
    input.lines.map((l) => ({ p: l.productId, v: l.variantId, q: l.quantity }))
  );
  guardParts.push(
    `NOT EXISTS (
       SELECT 1 FROM json_each(${ph()}) AS je
       WHERE NOT EXISTS (
         SELECT 1 FROM "Product"
         WHERE "id" = json_extract(je.value, '$.p') AND "isActive" = 1
           AND "stock" >= json_extract(je.value, '$.q')
       )
     )`
  );
  guardBinds.push(linePayload);
  guardParts.push(
    `NOT EXISTS (
       SELECT 1 FROM json_each(${ph()}) AS je
       WHERE json_extract(je.value, '$.v') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ProductVariant"
         WHERE "id" = json_extract(je.value, '$.v')
           AND "productId" = json_extract(je.value, '$.p')
           AND "stock" >= json_extract(je.value, '$.q')
       )
     )`
  );
  guardBinds.push(linePayload);

  if (coupon) {
    guardParts.push(`EXISTS (SELECT 1 FROM "Coupon" WHERE "id" = ${ph()} AND "isActive" = 1 AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit"))`);
    guardBinds.push(coupon.id);
    if (coupon.perCustomerLimit && coupon.perCustomerLimit > 0) {
      const identityGuards: string[] = [];
      if (input.customerId) {
        identityGuards.push(`"customerId" = ${ph()}`);
        guardBinds.push(input.customerId);
      }
      if (input.customerEmail) {
        identityGuards.push(`"customerEmail" = ${ph()}`);
        guardBinds.push(input.customerEmail.toLowerCase());
      }
      identityGuards.push(`"customerPhone" = ${ph()}`);
      guardBinds.push(input.address.phone);
      // per-customer usage counted over non-cancelled orders with this coupon
      guardParts.push(
        `(SELECT COUNT(*) FROM "Order" WHERE "couponCode" = ${ph()} AND "status" != 'CANCELLED' AND (${identityGuards.join(" OR ")})) < ${ph()}`
      );
      guardBinds.push(coupon.code, coupon.perCustomerLimit);
    }
  }
  if (input.paymentTrxId) {
    guardParts.push(`NOT EXISTS (SELECT 1 FROM "Payment" WHERE "transactionId" = ${ph()})`);
    guardBinds.push(input.paymentTrxId.toUpperCase());
  }

  const orderCols = `"id", "orderNumber", "customerId", "customerName", "customerPhone", "customerEmail", "status", "paymentStatus", "paymentMethod", "subtotal", "discountTotal", "shippingTotal", "codCharge", "total", "couponCode", "shippingAddress", "customerNote", "purchaseEventId", "estimatedDelivery", "createdAt", "updatedAt"`;
  // NOTE: no leading SELECT keyword — the INSERT provides it (single SELECT).
  const orderSelect = `${ph()}, 'SN' || (SELECT "value" FROM "SequenceCounter" WHERE "key" = 'order'), ${ph()}, ${ph()}, ${ph()}, ${ph()}, 'PENDING', ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, ${ph()}, 'purchase_SN' || (SELECT "value" FROM "SequenceCounter" WHERE "key" = 'order'), ${ph()}, ${ph()}, ${ph()}`;
  const orderBinds: unknown[] = [
    orderId,
    input.customerId,
    input.address.fullName,
    input.address.phone,
    input.customerEmail?.toLowerCase() ?? null,
    input.paymentMethod === "COD" ? "COD_PENDING" : "UNPAID",
    input.paymentMethod,
    subtotal,
    discount,
    shippingTotal,
    codCharge,
    total,
    coupon?.code ?? null,
    stringifyJSON(input.address),
    input.customerNote ?? null,
    d(now + estimatedDays * 86400_000),
    d(now),
    d(now),
  ];

  statements.push(
    (await d1()).prepare(
      `INSERT INTO "Order" (${orderCols}) SELECT ${orderSelect} WHERE ${guardParts.join(" AND ")}`
    )
    // Placeholder numbers were assigned guard-first (?1..?G) then
    // select (?G+1..) — the bind array follows that numbering exactly.
    .bind(...[...guardBinds, ...orderBinds].map(bindable) as (string | number | null)[])
  );

  // 3. Stock decrements — only when the order row exists (same transaction).
  //    The stock guard already ran in the INSERT's WHERE; this decrement
  //    repeats the guard defensively (belt-and-braces against interleaved
  //    writes between statements is impossible in one transaction, but the
  //    repeated guard costs nothing and keeps each statement self-safe).
  for (const line of input.lines) {
    statements.push(
      (await d1())
        .prepare(
          `UPDATE "Product" SET "stock" = "stock" - ?1, "soldCount" = "soldCount" + ?1, "updatedAt" = ?2
           WHERE "id" = ?3 AND "isActive" = 1 AND "stock" >= ?1
             AND EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?4)`
        )
        .bind(line.quantity, d(now), line.productId, orderId)
    );
    if (line.variantId) {
      statements.push(
        (await d1())
          .prepare(
            `UPDATE "ProductVariant" SET "stock" = "stock" - ?1
             WHERE "id" = ?2 AND "productId" = ?3 AND "stock" >= ?1
               AND EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?4)`
          )
          .bind(line.quantity, line.variantId, line.productId, orderId)
      );
    }
  }

  // 4. Coupon usage increment — guarded + conditional on the order existing.
  if (coupon) {
    statements.push(
      (await d1())
        .prepare(
          `UPDATE "Coupon" SET "usageCount" = "usageCount" + 1
           WHERE "id" = ?1 AND "isActive" = 1 AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")
             AND EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?2)`
        )
        .bind(coupon.id, orderId)
    );
  }

  // 5. Order items / status history / payment / supplier orders.
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    statements.push(
      (await d1())
        .prepare(
          `INSERT INTO "OrderItem" ("id", "orderId", "productId", "variantId", "name", "sku", "imageUrl", "unitPrice", "quantity", "total", "options", "supplierId")
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?2)`
        )
        .bind(
          itemId(i), orderId, line.productId, line.variantId, line.name, line.sku, line.imageUrl,
          line.unitPrice, line.quantity, line.total, line.options ? stringifyJSON(line.options) : null, line.supplierId
        )
    );
  }

  statements.push(
    (await d1())
      .prepare(
        `INSERT INTO "OrderStatusHistory" ("id", "orderId", "status", "note", "createdBy", "createdAt")
         SELECT ?1, ?2, 'PENDING', 'Order placed', 'system', ?3 WHERE EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?2)`
      )
      .bind(historyId, orderId, d(now))
  );

  statements.push(
    (await d1())
      .prepare(
        `INSERT INTO "Payment" ("id", "orderId", "method", "status", "amount", "transactionId", "createdAt")
         SELECT ?1, ?2, ?3, 'PENDING', ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?2)`
      )
      .bind(paymentId, orderId, input.paymentMethod, total, input.paymentTrxId ? input.paymentTrxId.toUpperCase() : null, d(now))
  );

  for (const [supplierId, group] of supplierGroups) {
    const sid = supplierOrderIds.get(supplierId);
    if (!sid) continue; // supplier no longer active — no supplier order
    const itemsTotal = group.reduce((sum, l) => sum + l.total, 0);
    statements.push(
      (await d1())
        .prepare(
          `INSERT INTO "SupplierOrder" ("id", "supplierId", "orderId", "status", "itemsTotal", "shippingFee", "total", "createdAt")
           SELECT ?1, ?2, ?3, 'PENDING', ?4, 0, ?4, ?5 WHERE EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?3)`
        )
        .bind(sid, supplierId, orderId, itemsTotal, d(now))
    );
  }

  // 6. ABORT sentinel — NOT NULL violation rolls back the whole batch when
  //    (and only when) the guarded order insert produced no row.
  statements.push(
    (await d1())
      .prepare(`INSERT INTO "CheckoutGuard" ("key") SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM "Order" WHERE "id" = ?1)`)
      .bind(orderId)
  );

  // ── Execute (serialized + retried — see Concurrency control above) ──
  let batchResults: D1Result[];
  try {
    batchResults = await serializeCheckoutWrite(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await (await d1()).batch(statements);
        } catch (error) {
          if (attempt < 3 && isTransientD1Error(error)) {
            await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 60));
            continue;
          }
          throw error;
        }
      }
    });
  } catch (batchError) {
    const message = String((batchError as Error)?.message ?? batchError ?? "");
    // A guard fired (sentinel or a natural constraint, e.g. TrxID unique).
    // Re-validate against the rolled-back state to name the actual problem.
    const { lines: reLines, errors: reErrors } = await validateCart(
      input.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }))
    );
    if (input.paymentTrxId && message.includes("Payment.transactionId")) {
      throw new CheckoutError("This transaction ID has already been used for another order.", 409);
    }
    if (reErrors.length > 0 || reLines.length === 0) {
      throw new CheckoutError(reErrors[0] ?? "Your cart items are no longer available");
    }
    if (coupon) {
      const re = await validateCoupon(coupon.code, subtotal, reLines, {
        customerId: input.customerId,
        email: input.customerEmail,
        phone: input.address.phone,
      });
      if (!re.ok) throw new CheckoutError(re.reason ?? "Coupon could not be applied", 422);
    }
    console.error("[checkout] batch failed:", batchError);
    throw new CheckoutError("We could not place your order. Please try again — your cart is untouched.", 500);
  }

  // The counter statement's RETURNING value is the first result.
  const counterValue = (batchResults[0]?.results?.[0] as { value?: number } | undefined)?.value;
  if (!counterValue || counterValue > 999_999) {
    // Should be impossible (the insert would have used it) — defensive.
    throw new CheckoutError("Order numbering exhausted — contact support", 500);
  }

  // Re-read through Prisma so the return shape matches the monolith exactly
  // (Prisma types, ISO date strings after JSON serialisation, items included).
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    throw new CheckoutError("We could not place your order. Please try again — your cart is untouched.", 500);
  }

  // ── Post-commit side effects ─────────────────────────────────────────
  // The order is COMMITTED at this point. Every step below is best-effort:
  // if any of them fails (DB hiccup, mail provider down, …) the customer
  // MUST still get a success response — surfacing an error here would make
  // them retry and place a DUPLICATE order while their stock is already
  // gone. Failures are logged for operators instead.
  const schedule = (promise: Promise<unknown>) => {
    if (input.waitUntil) input.waitUntil(promise.catch(() => undefined));
    else void promise.catch(() => undefined);
  };

  try {
    // Low stock notifications (single batched query)
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const stocked = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock: true, lowStockThreshold: true, name: true },
    });
    for (const product of stocked) {
      if (product.stock <= product.lowStockThreshold) {
        await notify("STOCK", `Low stock: ${product.name}`, `Only ${product.stock} units remaining (threshold ${product.lowStockThreshold}).`);
      }
    }

    // Admin notification
    await notify(
      "ORDER",
      `New order ${order.orderNumber}`,
      `${input.address.fullName} placed an order of ৳${total.toLocaleString()} (${input.lines.length} item${input.lines.length > 1 ? "s" : ""}).`,
      `/admin/orders/${order.id}`
    );

    // Customer confirmation email (guests included — their email is
    // collected at checkout)
    if (input.customerEmail) {
      const mail = orderConfirmationMail({
        orderNumber: order.orderNumber,
        customerName: input.address.fullName,
        total,
        items: input.lines.map((l) => ({ name: l.name, quantity: l.quantity, total: l.total })),
        estimatedDelivery,
        paymentLabel: paymentLabel(input.paymentMethod),
      });
      mail.to = input.customerEmail;
      schedule(sendMail(mail));
    }
  } catch (postCommitError) {
    console.error(`[checkout] post-commit side effects failed for ${order.orderNumber} (order IS placed):`, postCommitError);
  }

  // Supplier orders — processed after the response is flushed
  // (Workers-native waitUntil replaces Next.js `after()`).
  schedule(
    processPendingSupplierOrders(order.id).catch((e) =>
      console.error(`[supplier] background processing failed for ${order.orderNumber}:`, e)
    )
  );

  // Server-side Purchase tracking event (deduped with the browser copy via
  // purchaseEventId). Analytics must never break checkout — guarded too.
  schedule(
    recordServerEvent(
      {
        eventId: `purchase_${order.orderNumber}`,
        name: "Purchase",
        value: total,
        url: `/order-success/${order.orderNumber}`,
        quantity: input.lines.reduce((q, l) => q + l.quantity, 0),
      },
      { sessionKey: input.sessionKey, headers: input.requestHeaders ?? new Headers() }
    ).catch((trackingError) =>
      console.error(`[checkout] purchase event recording failed for ${order.orderNumber} (order IS placed):`, trackingError)
    )
  );

  return order;
}

// The D1 binding, resolved through the same isolate-scoped state as db.
async function d1(): Promise<D1Database> {
  const env = (globalThis as unknown as { __apiEnv?: { DB: D1Database } }).__apiEnv;
  if (!env?.DB) throw new Error("checkout used before the env bridge ran");
  return env.DB;
}
