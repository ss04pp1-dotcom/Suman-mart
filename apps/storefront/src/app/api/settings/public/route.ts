import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { getBrowserPixels } from "@/lib/pixels";
import { guestCheckoutOtpRequired } from "@/lib/email-gate";

export async function GET(_req: NextRequest) {
  const [general, payment, shipping, pixels] = await Promise.all([
    getSetting("general"),
    getSetting("payment"),
    getSetting("shipping"),
    getBrowserPixels(),
  ]);
  // Only public-safe fields; secrets never leave the server.
  // `card` is hard-disabled: no card gateway is integrated, so exposing it
  // would create orders that silently sit UNPAID forever.
  return ok({
    storeName: general.storeName,
    tagline: general.tagline,
    supportPhone: general.supportPhone,
    supportEmail: general.supportEmail,
    // Round-4 audit: guests must verify the email they checkout with while a
    // mail provider is configured (UI shows the OTP step; API enforces it).
    guestEmailVerification: guestCheckoutOtpRequired(),
    paymentMethods: {
      cod: payment.codEnabled,
      bkash: payment.bkashEnabled,
      bkashNumber: payment.bkashNumber,
      nagad: payment.nagadEnabled,
      nagadNumber: payment.nagadNumber,
      card: false,
    },
    shipping: {
      flatRate: shipping.flatRate,
      freeShippingThreshold: shipping.freeShippingThreshold,
      estimatedDaysMin: shipping.estimatedDaysMin,
      estimatedDaysMax: shipping.estimatedDaysMax,
      codCharge: shipping.codCharge,
    },
    pixels,
  });
}
