import { NextRequest } from "next/server";
import { ok, resolveRange } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { getProductAnalytics } from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;
  const url = new URL(req.url);
  const range = resolveRange(url);
  const take = Math.min(30, parseInt(url.searchParams.get("take") ?? "12", 10) || 12);
  return ok(await getProductAnalytics(range, take));
}
