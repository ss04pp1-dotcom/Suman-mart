import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { getCustomerSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { validateCart, validateCoupon, createOrder, CheckoutError, type CouponResult } from "@/lib/checkout";
import { checkoutSchema } from "@/lib/validators";
import { guestCheckoutOtpRequired } from "@/lib/email-gate";
import { consumeGuestOtp } from "@/lib/guest-otp";
import { ipRateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("checkout", 10, 10 * 60_000, req);
  if (!rl.ok) return fail("Too many checkout attempts. Please wait a moment.", 429);

  const body = await req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid checkout data", 422);
  const input = parsed.data;

  // Payment method availability check.
  //  • COD — always supported natively
  //  • BKASH / NAGAD — manual verification flow: the customer sends money to
  //    the merchant number, submits the transaction ID, staff verifies it in
  //    the admin console. Not an automated gateway, but a real, working flow.
  //  • CARD — requires a payment gateway that is NOT integrated yet; it can
  //    never pass this check, so orders can never silently sit "UNPAID forever".
  const paymentSettings = await getSetting("payment");
  if (input.paymentMethod === "COD" && !paymentSettings.codEnabled) {
    return fail("Cash on delivery is currently unavailable", 400);
  }
  if (input.paymentMethod === "CARD") {
    return fail("Card payment is not available yet — please choose another method", 400);
  }
  if (input.paymentMethod === "BKASH" && !paymentSettings.bkashEnabled) {
    return fail("bKash payment is currently unavailable", 400);
  }
  if (input.paymentMethod === "NAGAD" && !paymentSettings.nagadEnabled) {
    return fail("Nagad payment is currently unavailable", 400);
  }

  // Manual-payment transaction references are globally unique — the same
  // bKash/Nagad TrxID can never be attached to two orders (round-3 audit).
  // Reserved prefixes keep customer-supplied IDs in a separate namespace
  // from the deterministic IDs the admin flow generates (COD-…, MANUAL-…),
  // and `-RELEASED-` marks IDs freed from cancelled orders (round-4 audit)
  // — neither may be re-submitted as a buyer's claim.
  if (input.paymentTrxId) {
    const trxId = input.paymentTrxId.toUpperCase();
    if (/^(COD|MANUAL|REFUND)-/.test(trxId) || trxId.includes("-RELEASED-")) {
      return fail("That transaction ID is not valid — copy it exactly from your payment SMS", 422);
    }
    const clash = await db.payment.findFirst({
      where: { transactionId: trxId },
      select: { id: true, orderId: true },
    });
    if (clash) {
      return fail("This transaction ID has already been used for another order. If you believe this is a mistake, contact support with your order number.", 409, { code: "TRXID_ALREADY_USED" });
    }
  }

  // Server-side validation of every line. ANY invalid or stock-out item blocks
  // the whole order — silently dropping lines would mean the customer pays for
  // less than they believe they ordered.
  const { lines, errors } = await validateCart(input.items);
  if (errors.length > 0 || lines.length === 0) {
    return fail(errors[0] ?? "Your cart items are no longer available", 409, { errors: errors.length > 0 ? errors : ["Your cart is empty."] });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const customerSession = await getCustomerSession();
  const customer = customerSession
    ? await db.customer.findUnique({
        where: { id: customerSession.id },
        select: { id: true, email: true, isActive: true, emailVerifiedAt: true },
      })
    : null;

  // Guest checkout: email is REQUIRED — otherwise the buyer would never
  // receive an order confirmation (or a payment-verification receipt).
  if (!customer && !input.customerEmail) {
    return fail("Enter your email so we can send your order confirmation", 422, { code: "GUEST_EMAIL_REQUIRED" });
  }
  const orderEmail = customer?.email ?? input.customerEmail?.toLowerCase() ?? null;

  // NOTE: there is deliberately NO email-verification gate for SIGNED-IN
  // customers at checkout (removed in round 3: it only blocked logged-in
  // unverified users, and without a mail provider it deadlocked new accounts).
  //
  // Round-4 audit: GUESTS must however prove control of the email they
  // submit — while (and only while) a mail provider is configured. Without
  // this check anyone could place orders with someone else's address and the
  // platform would send that person unsolicited confirmation mail. Without a
  // provider no mail ever leaves the server, so no proof is needed (or
  // possible). The OTP is verified AND consumed here, before the order is
  // created — a failed order burns the code (request a new one) so one code
  // can never fund two orders.
  if (!customer && guestCheckoutOtpRequired()) {
    if (!orderEmail || !input.guestEmailOtp) {
      return fail("Enter the 6-digit code we emailed you to confirm your email address", 422, { code: "GUEST_OTP_REQUIRED" });
    }
    const otp = await consumeGuestOtp(orderEmail, input.guestEmailOtp);
    if (!otp.ok) {
      const message =
        otp.reason === "TOO_MANY_ATTEMPTS"
          ? "Too many wrong codes — request a new code and try again"
          : otp.reason === "EXPIRED"
            ? "That code has expired — request a new code and try again"
            : "That code is not correct — check your email and try again";
      return fail(message, 422, { code: "GUEST_OTP_INVALID" });
    }
  }

  const orderSettings = await getSetting("orders");
  if (!customer && !orderSettings.allowGuestCheckout) {
    return fail("Please sign in to complete your order", 401);
  }

  let couponResult: CouponResult | null = null;
  if (input.couponCode) {
    couponResult = await validateCoupon(input.couponCode, subtotal, lines, {
      customerId: customer?.id ?? null,
      email: orderEmail,
      phone: input.address.phone,
    });
    if (!couponResult.ok) {
      return fail(couponResult.reason ?? "Coupon could not be applied", 422);
    }
  }

  const store = await cookies();
  const sessionKey = store.get("sn_sk")?.value ?? null;

  try {
    const order = await createOrder({
      lines,
      couponResult,
      address: input.address,
      paymentMethod: input.paymentMethod,
      paymentTrxId: input.paymentTrxId ?? null,
      customerId: customer?.id ?? null,
      customerEmail: orderEmail,
      customerNote: input.customerNote ?? null,
      sessionKey,
      requestHeaders: req.headers,
    });

    return ok({
      orderNumber: order.orderNumber,
      total: order.total,
      purchaseEventId: order.purchaseEventId,
      estimatedDelivery: order.estimatedDelivery,
      paymentStatus: order.paymentStatus,
    });
  } catch (e) {
    if (e instanceof CheckoutError) return fail(e.message, e.status);
    console.error("[checkout] failed:", e);
    return fail("We could not place your order. Please try again — your cart is untouched.", 500);
  }
}
