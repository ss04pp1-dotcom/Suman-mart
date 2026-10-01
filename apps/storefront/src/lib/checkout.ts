import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { Coupon, Product, ProductVariant } from "@prisma/client";
import { getSetting } from "@/lib/settings";
import { stringifyJSON, parseJSON } from "@/lib/json";
import { notify } from "@/lib/notifications";
import { processPendingSupplierOrders } from "@/lib/suppliers/orders";
import { recordServerEvent } from "@/lib/tracking";
import { orderConfirmationMail, sendMail } from "@/lib/mailer";
import { after } from "next/server";

// ─────────────────────────────────────────────────────────────────────────
// Checkout business logic. Prices, stock, coupons and shipping are ALWAYS
// validated server-side — the client cart is treated as untrusted input.
//
// Concurrency model (createOrder):
//  • the whole order runs inside ONE db.$transaction
//  • stock is decremented with a guarded UPDATE (stock >= qty) so parallel
//    checkouts can never oversell
//  • the order number comes from an atomic counter row (UPDATE … RETURNING)
//  • coupon usage is incremented with a guarded UPDATE (usageCount < limit)
// Any guard that fails aborts the transaction and the customer sees a clear
// error instead of a partially-fulfilled order.
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
  coupon: Coupon | null;
}

/** Error carrying a customer-friendly message out of the transaction. */
export class CheckoutError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
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
    variantIds.length ? db.productVariant.findMany({ where: { id: { in: variantIds } } }) : Promise.resolve([] as ProductVariant[]),
  ]);
  const productMap = new Map<string, Product & { images: { url: string; alt: string | null }[]; supplierProduct: { supplierId: string } | null }>(
    products.map((p) => [p.id, p as Product & { images: { url: string; alt: string | null }[]; supplierProduct: { supplierId: string } | null }])
  );
  const variantMap = new Map<string, ProductVariant>(variantRows.map((v) => [v.id, v]));

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
    return { ok: true, discount: 0, freeShipping: true, coupon };
  }

  let discount = 0;
  if (coupon.type === "PERCENTAGE") {
    discount = Math.floor((subtotal * coupon.value) / 100);
    if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    discount = Math.min(coupon.value, subtotal);
  }

  return { ok: true, discount, freeShipping: false, coupon };
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

/**
 * Atomically allocate the next order number (SN100001, SN100002, …).
 * The counter row is initialized from the highest existing number, and the
 * increment happens in a single UPDATE … RETURNING statement — concurrent
 * checkouts can never generate the same number.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.sequenceCounter.findUnique({ where: { key: "order" } });
  if (!existing) {
    const last = await tx.order.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
    const lastSeq = last ? parseInt(last.orderNumber.replace(/\D/g, ""), 10) : 100000;
    const init = Number.isFinite(lastSeq) && lastSeq >= 100000 ? lastSeq : 100000;
    await tx.sequenceCounter
      .create({ data: { key: "order", value: init } })
      .catch(() => undefined); // concurrent initializer won the race — fine
  }
  const rows = await tx.$queryRaw<{ value: number }[]>`UPDATE "SequenceCounter" SET value = value + 1 WHERE key = 'order' RETURNING value`;
  const value = rows[0]?.value;
  if (!value || value > 999_999) throw new CheckoutError("Order numbering exhausted — contact support", 500);
  return `SN${value}`;
}

// ── Concurrency control ──────────────────────────────────────────────
// SQLite serializes writes at the database level; when several checkouts
// race, the losers block on the write lock and can hit Prisma's socket
// timeout (P1008) or a write conflict (P2034). Two layers of defense:
//   1. an in-process write mutex so concurrent checkouts take turns cleanly
//   2. a retry for P2034/P1008 for any residual contention (multi-instance)
let checkoutWriteChain: Promise<unknown> = Promise.resolve();

function serializeCheckoutWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = checkoutWriteChain.then(fn, fn);
  checkoutWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const TRANSIENT_PRISMA_CODES = new Set(["P2034", "P1008"]);

/**
 * Run a transaction with automatic retry on transient SQLite write
 * contention (Prisma P2034 write conflict / P1008 socket timeout).
 */
async function withTransactionRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (
        i < attempts - 1 &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        TRANSIENT_PRISMA_CODES.has(e.code)
      ) {
        await new Promise((r) => setTimeout(r, 40 * (i + 1) + Math.random() * 60));
        continue;
      }
      throw e;
    }
  }
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

  const order = await withTransactionRetry(() =>
    serializeCheckoutWrite(() =>
      db.$transaction(
        async (tx) => {
        try {
      // 1. Order number — atomic counter (no read-then-write race)
      const orderNumber = await nextOrderNumber(tx);

      // 2. Stock — guarded atomic decrement per line; a guard failing aborts
      //    the whole order (the customer is told which item ran out)
      for (const line of input.lines) {
        const productUpdate = await tx.product.updateMany({
          where: { id: line.productId, isActive: true, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity }, soldCount: { increment: line.quantity } },
        });
        if (productUpdate.count === 0) {
          throw new CheckoutError(`${line.name} just went out of stock — please review your cart.`);
        }
        if (line.variantId) {
          const variantUpdate = await tx.productVariant.updateMany({
            where: { id: line.variantId, productId: line.productId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (variantUpdate.count === 0) {
            throw new CheckoutError(`${line.name} — the selected option just went out of stock.`);
          }
        }
      }

      // 3. Coupon — atomic usage increment; limits re-checked under the
      //    transaction lock so two racing checkouts cannot both grab the
      //    last use / exceed a per-customer limit (guests count too —
      //    identified by email + phone).
      if (input.couponResult?.coupon) {
        const coupon = input.couponResult.coupon;
        if (coupon.perCustomerLimit && coupon.perCustomerLimit > 0) {
          const used = await couponUsesByIdentity(coupon.code, {
            customerId: input.customerId,
            email: input.customerEmail,
            phone: input.address.phone,
          });
          if (used >= coupon.perCustomerLimit) {
            throw new CheckoutError("You have already used this coupon the maximum number of times.", 422);
          }
        }
        const couponUpdate = await tx.coupon.updateMany({
          where: {
            id: coupon.id,
            isActive: true,
            ...(coupon.usageLimit ? { usageCount: { lt: coupon.usageLimit } } : {}),
          },
          data: { usageCount: { increment: 1 } },
        });
        if (couponUpdate.count === 0) {
          throw new CheckoutError("This coupon has reached its usage limit.", 422);
        }
      }

      // 4. Persist the order
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: input.customerId,
          customerName: input.address.fullName,
          customerPhone: input.address.phone,
          customerEmail: input.customerEmail ?? null,
          status: "PENDING",
          paymentStatus: input.paymentMethod === "COD" ? "COD_PENDING" : "UNPAID",
          paymentMethod: input.paymentMethod,
          subtotal,
          discountTotal: discount,
          shippingTotal,
          codCharge,
          total,
          couponCode: input.couponResult?.coupon?.code ?? null,
          shippingAddress: stringifyJSON(input.address),
          customerNote: input.customerNote ?? null,
          purchaseEventId: `purchase_${orderNumber}`,
          estimatedDelivery,
          items: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              name: l.name,
              sku: l.sku,
              imageUrl: l.imageUrl,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              total: l.total,
              options: l.options ? stringifyJSON(l.options) : null,
              supplierId: l.supplierId,
            })),
          },
          statusHistory: {
            create: { status: "PENDING", note: "Order placed", createdBy: "system" },
          },
          payments: {
            create: {
              method: input.paymentMethod,
              status: "PENDING",
              amount: total,
              // Manual mobile payments carry the customer's transaction
              // reference so staff can verify it in the admin console.
              // Uppercase-normalized — the unique index is byte-exact, and the
              // duplicate pre-check in the route normalizes the same way.
              transactionId: input.paymentTrxId ? input.paymentTrxId.toUpperCase() : null,
            },
          },
        },
        include: { items: true },
      });

      // 5. Supplier order rows for dropshipped items (PENDING — the actual
      //    supplier API call happens AFTER the response so a slow supplier
      //    never blocks the customer; see processPendingSupplierOrders)
      const dropshipLines = input.lines.filter((l) => l.supplierId);
      if (dropshipLines.length > 0) {
        const supplierGroups = new Map<string, ValidatedLine[]>();
        for (const line of dropshipLines) {
          const group = supplierGroups.get(line.supplierId as string) ?? [];
          group.push(line);
          supplierGroups.set(line.supplierId as string, group);
        }
        const suppliers = await tx.supplier.findMany({
          where: { id: { in: [...supplierGroups.keys()] }, isActive: true },
          select: { id: true },
        });
        const activeSupplierIds = new Set(suppliers.map((s) => s.id));
        for (const [supplierId, group] of supplierGroups) {
          if (!activeSupplierIds.has(supplierId)) continue;
          await tx.supplierOrder.create({
            data: {
              supplierId,
              orderId: created.id,
              status: "PENDING",
              itemsTotal: group.reduce((sum, l) => sum + l.total, 0),
              shippingFee: 0,
              total: group.reduce((sum, l) => sum + l.total, 0),
            },
          });
        }
      }

      return created;
      } catch (txError) {
          // Race-safe duplicate-TrxID guard: two concurrent checkouts can both
          // pass the route-level pre-check; the unique index on
          // Payment.transactionId stops the loser here. Surface a clean error
          // (the whole transaction rolls back — no stock/coupon side effects).
          if (txError instanceof Prisma.PrismaClientKnownRequestError && txError.code === "P2002") {
            const target = (txError.meta?.target as string[] | string | undefined) ?? [];
            if (String(target).includes("transactionId")) {
              throw new CheckoutError("This transaction ID has already been used for another order.", 409);
            }
          }
          throw txError;
        }
      },
      { timeout: 15_000 }
      )
    )
  );

  // ── Post-transaction side effects ──────────────────────────────────
  // The order is COMMITTED at this point. Every step below is best-effort:
  // if any of them fails (DB hiccup, mail provider down, …) the customer
  // MUST still get a success response — surfacing an error here would make
  // them retry and place a DUPLICATE order while their stock is already
  // gone. Failures are logged for operators instead.

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
      void sendMail(mail).catch(() => undefined);
    }

    // Supplier orders — processed after the response is flushed
    after(async () => {
      await processPendingSupplierOrders(order.id).catch((e) =>
        console.error(`[supplier] background processing failed for ${order.orderNumber}:`, e)
      );
    });
  } catch (postCommitError) {
    console.error(`[checkout] post-commit side effects failed for ${order.orderNumber} (order IS placed):`, postCommitError);
  }

  // Server-side Purchase tracking event (deduped with the browser copy via
  // purchaseEventId). Analytics must never break checkout — guarded too.
  try {
    await recordServerEvent(
      {
        eventId: `purchase_${order.orderNumber}`,
        name: "Purchase",
        value: total,
        url: `/order-success/${order.orderNumber}`,
        quantity: input.lines.reduce((q, l) => q + l.quantity, 0),
      },
      { sessionKey: input.sessionKey, headers: input.requestHeaders ?? new Headers() }
    );
  } catch (trackingError) {
    console.error(`[checkout] purchase event recording failed for ${order.orderNumber} (order IS placed):`, trackingError);
  }

  return order;
}
