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

  // Round-5 audit: the GUEST EMAIL IS OPTIONAL. This is a COD-first store and
  // a large share of Bangladeshi buyers do not use email at all — the shipping
  // phone is the real fulfillment channel, and demanding an email (plus an
  // OTP) at checkout measurably hurt conversion.
  //
  // Spam model unchanged in strength: an address the buyer did NOT prove
  // control of is only a risk when the platform actually SENDS mail to it.
  //   • Guest gives NO email → no confirmation mail is ever sent → no OTP.
  //   • Guest GIVES an email → prove control with the one-time code, but
  //     only while a provider is configured & healthy (the only situation in
  //     which unsolicited mail could actually be delivered — round-4 audit;
  //     the outage relaxation is round-5).
  //   • Signed-in customers are identified by their account email (no gate —
  //     removed in round 3: it only blocked logged-in unverified users, and
  //     without a mail provider it deadlocked new accounts).
  const orderEmail = customer?.email ?? input.customerEmail?.toLowerCase() ?? null;

  if (!customer && guestCheckoutOtpRequired() && orderEmail) {
    if (!input.guestEmailOtp) {
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
