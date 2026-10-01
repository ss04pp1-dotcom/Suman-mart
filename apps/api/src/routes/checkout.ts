// Checkout endpoints — Hono port of apps/storefront/src/app/api/checkout/*
// (POST /checkout, POST /checkout/guest-otp) and /api/cart/validate.

import { Hono } from "hono";
import type { Env } from "../env";
import { ok, fail, sameOrigin } from "@/lib/api";
import { getCustomerSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { validateCart, validateCoupon, createOrder, CheckoutError, type CouponResult } from "@/lib/checkout";
import { checkoutSchema, cartItemSchema } from "@/lib/validators";
import { guestCheckoutOtpRequired } from "@/lib/email-gate";
import { consumeGuestOtp, issueGuestOtp, guestOtpMailBody } from "@/lib/guest-otp";
import { ipRateLimit, rateLimit } from "@/lib/rate-limit";
import { sendMail } from "@/lib/mailer";
import { getCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { z } from "zod";

export const checkoutApi = new Hono<{ Bindings: Env }>();

// POST /v1/checkout
checkoutApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const rl = await ipRateLimit("checkout", 10, 10 * 60_000, c.req.raw);
  if (!rl.ok) return fail(c, "Too many checkout attempts. Please wait a moment.", 429);

  const body = await c.req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid checkout data", 422);
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
    return fail(c, "Cash on delivery is currently unavailable", 400);
  }
  if (input.paymentMethod === "CARD") {
    return fail(c, "Card payment is not available yet — please choose another method", 400);
  }
  if (input.paymentMethod === "BKASH" && !paymentSettings.bkashEnabled) {
    return fail(c, "bKash payment is currently unavailable", 400);
  }
  if (input.paymentMethod === "NAGAD" && !paymentSettings.nagadEnabled) {
    return fail(c, "Nagad payment is currently unavailable", 400);
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
      return fail(c, "That transaction ID is not valid — copy it exactly from your payment SMS", 422);
    }
    const clash = await db.payment.findFirst({
      where: { transactionId: trxId },
      select: { id: true, orderId: true },
    });
    if (clash) {
      return fail(c, "This transaction ID has already been used for another order. If you believe this is a mistake, contact support with your order number.", 409, "TRXID_ALREADY_USED");
    }
  }

  // Server-side validation of every line. ANY invalid or stock-out item blocks
  // the whole order — silently dropping lines would mean the customer pays for
  // less than they believe they ordered.
  const { lines, errors } = await validateCart(input.items);
  if (errors.length > 0 || lines.length === 0) {
    return fail(c, errors[0] ?? "Your cart items are no longer available", 409);
  }

  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);

  const customerSession = await getCustomerSession(c.req.raw);
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
      return fail(c, "Enter the 6-digit code we emailed you to confirm your email address", 422, "GUEST_OTP_REQUIRED");
    }
    const otp = await consumeGuestOtp(orderEmail, input.guestEmailOtp);
    if (!otp.ok) {
      const message =
        otp.reason === "TOO_MANY_ATTEMPTS"
          ? "Too many wrong codes — request a new code and try again"
          : otp.reason === "EXPIRED"
            ? "That code has expired — request a new code and try again"
            : "That code is not correct — check your email and try again";
      return fail(c, message, 422, "GUEST_OTP_INVALID");
    }
  }

  const orderSettings = await getSetting("orders");
  if (!customer && !orderSettings.allowGuestCheckout) {
    return fail(c, "Please sign in to complete your order", 401);
  }

  let couponResult: CouponResult | null = null;
  if (input.couponCode) {
    couponResult = await validateCoupon(input.couponCode, subtotal, lines, {
      customerId: customer?.id ?? null,
      email: orderEmail,
      phone: input.address.phone,
    });
    if (!couponResult.ok) {
      return fail(c, couponResult.reason ?? "Coupon could not be applied", 422);
    }
  }

  const sessionKey = getCookie(c.req.raw, "sn_sk") ?? null;

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
      requestHeaders: c.req.raw.headers,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    });

    return ok(c, {
      orderNumber: order.orderNumber,
      total: order.total,
      purchaseEventId: order.purchaseEventId,
      estimatedDelivery: order.estimatedDelivery,
      paymentStatus: order.paymentStatus,
    });
  } catch (e) {
    if (e instanceof CheckoutError) return fail(c, e.message, e.status);
    console.error("[checkout] failed:", e);
    return fail(c, "We could not place your order. Please try again — your cart is untouched.", 500);
  }
});

// POST /v1/checkout/guest-otp
//
// Round-4 audit: guests must prove control of the email they give at checkout
// (otherwise the store is an open "send unsolicited mail to arbitrary
// addresses" service). This endpoint issues the one-time code; the checkout
// API verifies it. Only available while a mail provider is configured.
//
// Round-5 audit additions:
//   • A DAILY per-email cap — the 10-minute windows (per IP and per email)
//     bounded request RATE, but an attacker rotating IPs could keep one
//     address at its per-email ceiling indefinitely. The daily cap is the
//     hard bound on mail-bombing: one address can never receive more than
//     10 code mails per day, whatever the source IPs.
//   • The response tells the truth about delivery (`sent`), and three
//     consecutive failures trip the outage breaker (src/lib/mailer.ts) which
//     relaxes the OTP gate automatically.
checkoutApi.post("/guest-otp", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email("Enter a valid email address") }).safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid email", 422);
  const email = parsed.data.email.toLowerCase().trim();

  if (!guestCheckoutOtpRequired()) {
    return fail(c, "Email verification codes are not required right now", 400, "OTP_NOT_REQUIRED");
  }

  // Three-dimensional throttling: per IP (rotating IPs still hit the email
  // limits), per EMAIL per 10 minutes, and per EMAIL per DAY — the spam
  // target itself is bounded on both timescales, so an attacker cannot use
  // the endpoint to flood one address, rotate addresses from one IP, or
  // sustain the per-email ceiling past the daily cap.
  const rlIp = await ipRateLimit("guest-otp", 5, 10 * 60_000, c.req.raw);
  if (!rlIp.ok) {
    return fail(c, "Too many code requests. Please wait a few minutes.", 429);
  }
  const rlEmail = await rateLimit(`guest-otp-email:${email}`, 3, 10 * 60_000);
  if (!rlEmail.ok) {
    return fail(c, "A code was recently sent to this email. Please wait a few minutes.", 429);
  }
  const rlEmailDaily = await rateLimit(`guest-otp-daily:${email}`, 10, 24 * 60 * 60_000);
  if (!rlEmailDaily.ok) {
    return fail(c, "Daily code limit reached for this email — try again tomorrow, or leave the email field empty to continue without a confirmation.", 429);
  }

  const code = await issueGuestOtp(email);
  const general = await getSetting("general");
  const delivery = await sendMail({
    to: email,
    subject: `${general.storeName} — your checkout code`,
    body: guestOtpMailBody(code, general.storeName),
  });

  if (!delivery.delivered) {
    // Honest response: the code WAS issued (it can still be used if it turns
    // up), but no mail left the server. The buyer may retry shortly or
    // continue without an email confirmation; repeated failures relax the
    // OTP gate automatically via the outage breaker.
    return ok(c, { sent: false, reason: "PROVIDER_UNAVAILABLE", expiresInMinutes: 10 });
  }
  return ok(c, { sent: true, expiresInMinutes: 10 });
});

// POST /v1/cart/validate — server-side cart re-validation (prices, stock,
// coupon preview, shipping totals). Mounted at /cart by index.ts.
checkoutApi.post("/validate", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      items: z.array(cartItemSchema),
      couponCode: z.string().max(40).optional().nullable(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, "Invalid cart payload", 422);

  const { items, couponCode } = parsed.data;
  const session = await getCustomerSession(c.req.raw);
  const customer = session ? await db.customer.findUnique({ where: { id: session.id } }) : null;

  const { lines, errors } = await validateCart(items);
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);

  let couponResult: CouponResult | null = null;
  if (couponCode && lines.length > 0) {
    couponResult = await validateCoupon(couponCode, subtotal, lines, {
      customerId: customer?.id ?? null,
      email: customer?.email ?? null,
      // phone identity is applied at order time from the shipping address
    });
  }

  const shippingSettings = await getSetting("shipping");
  const discount = couponResult?.ok ? couponResult.discount : 0;
  const freeShipping =
    couponResult?.ok && couponResult.freeShipping ||
    (shippingSettings.freeShippingThreshold > 0 && subtotal - discount >= shippingSettings.freeShippingThreshold);
  const shippingTotal = lines.length === 0 || freeShipping ? 0 : shippingSettings.flatRate;
  const total = subtotal - discount + shippingTotal;

  return ok(c, {
    lines: lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      imageUrl: l.imageUrl,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      total: l.total,
      options: l.options,
      stock: l.stock,
    })),
    errors,
    coupon: couponResult
      ? { ok: couponResult.ok, reason: couponResult.reason ?? null, code: couponResult.coupon?.code ?? null, discount: couponResult.discount, freeShipping: couponResult.freeShipping, type: couponResult.coupon?.type ?? null }
      : null,
    totals: { subtotal, discount, shippingTotal, codCharge: shippingSettings.codCharge, total, freeShipping },
  });
});
