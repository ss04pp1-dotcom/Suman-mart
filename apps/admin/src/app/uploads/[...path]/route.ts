import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

// Media is served by the backend origin (until media migrates to R2 + the
// Workers API — see docs/FEATURE-INVENTORY.md §8).

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return proxyToBackend(_req, "/uploads", (await ctx.params).path);
}
