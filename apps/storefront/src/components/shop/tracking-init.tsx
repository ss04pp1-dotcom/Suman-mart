"use client";

import { track, loadPixels } from "@/lib/tracking-client";
import { useConsent } from "@/lib/stores/consent";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Initializes browser tracking for the storefront:
 *  1. Captures UTM + session key on first load
 *  2. Fires PageView on every route change (analytics consent required)
 *  3. Loads third-party pixels once marketing consent is granted
 */
export function TrackingInit() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const consent = useConsent();
  const lastPath = useRef<string | null>(null);

  // Fire PageView whenever the route changes
  useEffect(() => {
    if (!consent.decided) return; // no tracking before a consent choice
    if (lastPath.current === pathname + searchParams.toString()) return;
    lastPath.current = pathname + searchParams.toString();
    track("PageView", { eventId: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  }, [pathname, searchParams, consent.decided]);

  // Load pixels when marketing consent is granted
  useEffect(() => {
    if (consent.marketing) loadPixels();
  }, [consent.marketing]);

  return null;
}
