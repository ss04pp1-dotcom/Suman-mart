import { NextRequest } from "next/server";
import { proxyMedia } from "@/lib/backend-proxy";

// Admin-uploaded media lives in R2 and is served by the Workers API's
// /v1/media route; this proxy keeps the historical /uploads/* URLs working
// (DB rows and <img> tags reference them).

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxyMedia(req, "/uploads", (await ctx.params).path);
}
