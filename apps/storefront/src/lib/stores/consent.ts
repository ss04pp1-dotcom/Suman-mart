"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConsentChoice = "ACCEPT_ALL" | "ESSENTIAL_ONLY" | "CUSTOM" | "REJECTED" | null;

interface ConsentState {
  choice: ConsentChoice;
  analytics: boolean;
  marketing: boolean;
  decided: boolean;
  decide: (choice: Exclude<ConsentChoice, null>, analytics?: boolean, marketing?: boolean) => void;
  reset: () => void;
}

export const useConsent = create<ConsentState>()(
  persist(
    (set) => ({
      choice: null,
      // Essential cookies are always on; analytics/marketing default OFF until consent
      analytics: false,
      marketing: false,
      decided: false,
      decide: (choice, analytics, marketing) =>
        set({
          choice,
          decided: true,
          analytics: choice === "ACCEPT_ALL" ? true : analytics ?? false,
          marketing: choice === "ACCEPT_ALL" ? true : marketing ?? false,
        }),
      reset: () => set({ choice: null, analytics: false, marketing: false, decided: false }),
    }),
    // skipHydration — rehydrated centrally after mount (see components/shop/store-hydration.tsx)
    { name: "sn-consent", skipHydration: true }
  )
);
