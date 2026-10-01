// /v1/settings/public — public-safe store settings (D1 port of
// apps/storefront/src/app/api/settings/public/route.ts).
// Only public fields; secrets never leave the server.

import { Hono } from "hono";
import type { Env } from "../env";
import { ok } from "../lib/respond";
import { getBrowserPixels, getGeneral, getPayment, getShipping } from "../lib/settings";

export const settingsApi = new Hono<{ Bindings: Env }>();

settingsApi.get("/public", async (c) => {
  const [general, payment, shipping, pixels] = await Promise.all([
    getGeneral(c.env),
    getPayment(c.env),
    getShipping(c.env),
    getBrowserPixels(c.env),
  ]);

  return ok(c, {
    storeName: general.storeName,
    tagline: general.tagline,
    supportPhone: general.supportPhone,
    supportEmail: general.supportEmail,
    // Guest OTP enforcement lives with the checkout service (write-path not
    // yet ported — see docs/FEATURE-INVENTORY.md §8). The API reports the
    // configured policy for display purposes.
    guestEmailVerification: false,
    paymentMethods: {
      cod: payment.codEnabled,
      bkash: payment.bkashEnabled,
      bkashNumber: payment.bkashNumber,
      nagad: payment.nagadEnabled,
      nagadNumber: payment.nagadNumber,
      // Hard-disabled: no card gateway is integrated; exposing it would
      // create orders that silently sit UNPAID forever.
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
