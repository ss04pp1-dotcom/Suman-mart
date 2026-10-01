import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { getLiveActivity } from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;
  const take = Math.min(30, parseInt(new URL(req.url).searchParams.get("take") ?? "20", 10) || 20);
  return ok(await getLiveActivity(take));
}
