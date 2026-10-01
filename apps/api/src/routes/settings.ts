// GET /v1/settings/public — public-safe store settings (Hono port of
// apps/storefront/src/app/api/settings/public/route.ts).
// Only public fields; secrets never leave the server.

import { Hono } from "hono";
import type { Env } from "../env";
import { ok } from "../lib/respond";
import { getSetting } from "@/lib/settings";
import { getBrowserPixels } from "@/lib/pixels";
import { guestCheckoutOtpRequired } from "@/lib/email-gate";

export const settingsApi = new Hono<{ Bindings: Env }>();

settingsApi.get("/public", async (c) => {
  const [general, payment, shipping, pixels] = await Promise.all([
    getSetting("general"),
    getSetting("payment"),
    getSetting("shipping"),
    getBrowserPixels(),
  ]);
  // Only public-safe fields; secrets never leave the server.
  // `card` is hard-disabled: no card gateway is integrated, so exposing it
  // would create orders that silently sit UNPAID forever.
  return ok(c, {
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
});
