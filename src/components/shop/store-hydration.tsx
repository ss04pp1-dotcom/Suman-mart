"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/stores/cart";
import { useWishlist } from "@/lib/stores/wishlist";
import { useConsent } from "@/lib/stores/consent";

/**
 * Rehydrates the persisted client stores (cart / wishlist / consent) after
 * mount. The stores opt into `skipHydration` so that SSR output and the first
 * client render always agree (empty stores), which prevents React hydration
 * mismatches — previously a persisted cart crashed every storefront page in
 * production ("client-side exception" error boundary).
 */
export function StoreHydration() {
  useEffect(() => {
    void useCart.persist.rehydrate();
    void useWishlist.persist.rehydrate();
    void useConsent.persist.rehydrate();
  }, []);
  return null;
}
