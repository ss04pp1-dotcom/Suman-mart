"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WishlistEntry {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  price: number;
  addedAt: number;
}

interface WishlistState {
  items: WishlistEntry[];
  toggle: (entry: WishlistEntry) => void;
  has: (productId: string) => boolean;
  remove: (productId: string) => void;
  clear: () => void;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (entry) =>
        set((state) => ({
          items: state.items.some((i) => i.productId === entry.productId)
            ? state.items.filter((i) => i.productId !== entry.productId)
            : [...state.items, entry],
        })),
      has: (productId) => get().items.some((i) => i.productId === productId),
      remove: (productId) =>
        set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
      clear: () => set({ items: [] }),
    }),
    // skipHydration — rehydrated centrally after mount (see components/shop/store-hydration.tsx)
    { name: "sn-wishlist", skipHydration: true }
  )
);
