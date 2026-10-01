"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/tracking-client";

/** Fires the ViewContent event once when the product detail page mounts. */
export function ProductDetailTracker({ productId, productName }: { productId: string; productName: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track("ViewContent", { productId, productName });
  }, [productId, productName]);

  return null;
}
