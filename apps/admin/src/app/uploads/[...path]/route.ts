import { NextRequest } from "next/server";
import { proxyMediaToBackend } from "@/lib/backend-proxy";

// Media lives in R2 and is served by the Workers API's /v1/media route
// (product/banner/category seed assets were migrated; uploads are stored
// there directly — see apps/api/scripts/migrate-media-to-r2.sh).

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return proxyMediaToBackend("uploads", (await ctx.params).path);
}
