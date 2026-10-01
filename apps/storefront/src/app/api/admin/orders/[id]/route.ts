import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { ORDER_STATUSES } from "@/lib/format";
import { allowedTransitions, isValidTransition, restoreOrderStock, releasePendingTransactionIds, isOrderStatus } from "@/lib/order-flow";
import { orderStatusMail, sendMail } from "@/lib/mailer";
import { getSetting } from "@/lib/settings";
import { z } from "zod";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("orders.view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const order = await db.order.findFirst({
    where: { OR: [{ id }, { orderNumber: id }] },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
      items: { include: { product: { select: { slug: true } } } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: true,
      supplierOrders: { include: { supplier: { select: { id: true, name: true } } } },
    },
  });
  if (!order) return fail("Order not found", 404);

  const paymentSettings = await getSetting("payment");
  const merchantNumber =
    order.paymentMethod === "BKASH" ? paymentSettings.bkashNumber : order.paymentMethod === "NAGAD" ? paymentSettings.nagadNumber : "";
  return ok({ ...order, allowedStatuses: allowedTransitions(order.status), paymentMerchantNumber: merchantNumber });
}

const updateSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(["UNPAID", "PAID", "COD_PENDING", "REFUNDED"]).optional(),
  trackingNumber: z.string().max(60).optional().nullable(),
  courier: z.string().max(60).optional().nullable(),
  internalNotes: z.string().max(2000).optional().nullable(),
  note: z.string().max(500).optional(),
  // Round-4 audit: marking a MANUAL (bKash/Nagad) payment PAID requires the
  // staff member to confirm they matched the expected amount + TrxID against
  // the merchant SMS/statement. Enforced server-side, not just in the UI.
  smsVerified: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("orders.manage");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const order = await db.order.findFirst({ where: { OR: [{ id }, { orderNumber: id }] } });
  if (!order) return fail("Order not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid update", 422);
  const input = parsed.data;

  // Status lifecycle rules — no backwards jumps, no resurrection of terminal states
  if (input.status && input.status !== order.status) {
    if (!isOrderStatus(order.status) || !isValidTransition(order.status, input.status)) {
      const allowed = allowedTransitions(order.status);
      return fail(
        allowed.length === 0
          ? `Order is ${order.status} — no further status changes are allowed`
          : `Cannot move order from ${order.status} to ${input.status}. Allowed: ${allowed.join(", ")}`,
        422,
        { allowedStatuses: allowed }
      );
    }
  }

  // Round-4 audit: a TrxID is only the BUYER's claim — the system cannot match
  // amounts or sender numbers (no gateway API). The one control that matters is
  // a human checking the merchant SMS. Marking a manual payment PAID therefore
  // REQUIRES an explicit smsVerified=true acknowledgement.
  const isManualPayment = order.paymentMethod === "BKASH" || order.paymentMethod === "NAGAD";
  if (
    input.paymentStatus === "PAID" &&
    order.paymentStatus !== "PAID" &&
    isManualPayment &&
    input.smsVerified !== true
  ) {
    return fail(
      "Confirm the SMS match before marking this payment received — tick “I matched the amount and TrxID against the merchant SMS/statement”.",
      422,
      { code: "SMS_MATCH_REQUIRED" }
    );
  }

  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
      ...(input.courier !== undefined ? { courier: input.courier } : {}),
      ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
    },
  });

  // ── Payment-status side effects run BEFORE the status-change side effects
  // (round-5 audit). The ordering is load-bearing for one combined request:
  //   { status: "CANCELLED", paymentStatus: "PAID", smsVerified: true }
  // — “the money DID arrive, we refunded it outside the system (bKash/Nagad
  // app), and we are cancelling the order”. The payment row must flip to
  // SUCCESS FIRST, so the release step in the status block below then finds
  // no PENDING claim to free: the verified TrxID stays locked forever. In the
  // old order the release ran first and freed the ID a few lines before the
  // flip — the lock was lost in exactly the case where the money had in fact
  // arrived, letting the buyer reuse one real transfer on a second order.
  if (input.paymentStatus && input.paymentStatus !== order.paymentStatus) {
    // Round-3 audit: staff verification must keep the BUYER's transaction
    // reference. Instead of creating a detached MANUAL-<timestamp> payment,
    // flip the order's existing PENDING payment (which carries the customer's
    // bKash/Nagad TrxID) to the verified state. A new row is only created
    // when none exists, with a deterministic per-order ID (timestamps can
    // collide; order numbers cannot).
    let paymentNote = "";
    // Round-5 audit: identity of the row that ended up verified — needed for
    // the dedicated audit entry below.
    let verifiedPaymentId: string | null = null;
    let verifiedTrxId: string | null = null;
    // Deterministic, collision-proof transaction ID for rows the admin flow
    // creates (repeated PAID↔REFUNDED cycles append -2, -3, … — the unique
    // index on Payment.transactionId is the hard guarantee).
    const uniqueTrxId = async (prefix: string): Promise<string> => {
      const taken = new Set(
        (
          await db.payment.findMany({
            where: { transactionId: { startsWith: prefix } },
            select: { transactionId: true },
          })
        )
          .map((p) => p.transactionId)
          .filter((t): t is string => Boolean(t))
      );
      let candidate = prefix;
      let n = 2;
      while (taken.has(candidate)) candidate = `${prefix}-${n++}`;
      return candidate;
    };
    if (input.paymentStatus === "PAID") {
      const pending = await db.payment.findFirst({
        where: { orderId: order.id, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (pending) {
        await db.payment.update({ where: { id: pending.id }, data: { status: "SUCCESS" } });
        paymentNote = pending.transactionId ? `TrxID ${pending.transactionId} verified` : "Payment marked received";
        verifiedPaymentId = pending.id;
        verifiedTrxId = pending.transactionId;
      } else {
        const created = await db.payment.create({
          data: {
            orderId: order.id,
            method: order.paymentMethod,
            status: "SUCCESS",
            amount: order.total,
            transactionId: await uniqueTrxId(`${order.paymentMethod}-${order.orderNumber}`),
          },
        });
        paymentNote = "Payment marked received";
        verifiedPaymentId = created.id;
        verifiedTrxId = created.transactionId;
      }
      // Round-5 audit: smsVerified is a boolean that arrives from the client —
      // the audit trail must record WHO ticked the SMS-match confirmation,
      // for WHICH payment (TrxID + amount + method), and WHEN. The generic
      // order.updated entry only lists field NAMES, which is not enough to
      // answer “who verified this money?” months later.
      if (isManualPayment) {
        await writeAudit(guard.admin.id, "payment.sms_verified", "payment", verifiedPaymentId, {
          orderNumber: order.orderNumber,
          method: order.paymentMethod,
          amount: order.total,
          transactionId: verifiedTrxId,
          smsConfirmedBy: `${guard.admin.name} <${guard.admin.email}>`,
          smsConfirmedAt: new Date().toISOString(),
        });
      }
    } else if (input.paymentStatus === "REFUNDED") {
      const success = await db.payment.findFirst({
        where: { orderId: order.id, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
      });
      if (success) {
        await db.payment.update({ where: { id: success.id }, data: { status: "REFUNDED" } });
        paymentNote = "Successful payment marked refunded";
      } else {
        await db.payment.create({
          data: {
            orderId: order.id,
            method: order.paymentMethod,
            status: "REFUNDED",
            amount: order.total,
            transactionId: await uniqueTrxId(`REFUND-${order.orderNumber}`),
          },
        });
        paymentNote = "Refund recorded";
      }
    }
    // UNPAID / COD_PENDING are order-level corrections — existing payment
    // history rows stay untouched and no new row is invented.
    await notify("PAYMENT", `Payment ${input.paymentStatus} for ${order.orderNumber}`, paymentNote || `Updated by ${guard.admin.name}.`, `/admin/orders/${order.id}`);
  }

  if (input.status && input.status !== order.status) {
    await db.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: input.status,
        note: input.note ?? null,
        createdBy: `admin:${guard.admin.id}`,
      },
    });
    await notify("ORDER", `Order ${order.orderNumber} → ${input.status}`, input.note ?? `Status updated by ${guard.admin.name}.`, `/admin/orders/${order.id}`);

    // Cancellation / return → give reserved stock back (exactly once) and
    // RELEASE the buyer's unverified TrxID claim so the same real transfer can
    // fund a replacement order (round-4 audit).
    if (input.status === "CANCELLED" || input.status === "RETURNED") {
      const released = await releasePendingTransactionIds(order.id).catch(() => 0);
      if (released > 0) {
        await notify(
          "PAYMENT",
          `TrxID released for ${order.orderNumber}`,
          `The order was marked ${input.status}; its unverified transaction reference is now free for the buyer to reuse on a new order.`
        );
      }
      const restored = await restoreOrderStock(order.id).catch(() => false);
      if (restored) {
        await notify("STOCK", `Stock restored for ${order.orderNumber}`, `Reserved units were returned to inventory after the order was marked ${input.status}.`);
      }
    }

    // Customer status email
    if (order.customerEmail) {
      const mail = orderStatusMail({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: input.status,
        note: input.note ?? null,
      });
      mail.to = order.customerEmail;
      void sendMail(mail);
    }
  }

  await writeAudit(guard.admin.id, "order.updated", "order", order.id, { fields: Object.keys(input) });
  return ok(updated);
}
