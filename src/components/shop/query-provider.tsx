"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * React Query provider for the storefront. Pages such as the product listing
 * use `useQuery` for data fetching; without this provider those pages crash
 * with "No QueryClient set" (previously surfaced as a client-side exception
 * on /products in production).
 */
export function ShopQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
