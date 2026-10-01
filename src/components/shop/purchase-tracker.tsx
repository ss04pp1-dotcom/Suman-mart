"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/tracking-client";

/**
 * Fires the browser-side Purchase event with the SAME eventId the server used
 * (purchase_{orderNumber}) — enabling cross-channel deduplication.
 */
export function PurchaseTracker({
  eventId,
  value,
  orderNumber,
}: {
  eventId: string;
  value: number;
  orderNumber: string;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track("Purchase", { eventId, value, quantity: 1 });
    void orderNumber;
  }, [eventId, value, orderNumber]);

  return null;
}
