import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

// Catch-all proxy for the storefront API surface. The storefront is a pure
// UI deployment — ALL business logic runs on the shared Cloudflare Workers
// API (see docs/FEATURE-INVENTORY.md §8, Phase 9). Same-origin /api/* paths
// map onto the versioned API surface ${BACKEND_ORIGIN}/v1/*; cookies are
// forwarded verbatim in both directions, so sessions stay first-party.

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api", (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api", (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api", (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api", (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api", (await ctx.params).path);
}
