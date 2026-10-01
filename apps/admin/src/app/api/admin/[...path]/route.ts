import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

// Catch-all proxy for the admin API surface. The admin application is a pure
// UI deployment — business logic lives on the shared backend (see
// docs/FEATURE-INVENTORY.md §8 for the migration state).

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api/admin", (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api/admin", (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api/admin", (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api/admin", (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxyToBackend(req, "/api/admin", (await ctx.params).path);
}
