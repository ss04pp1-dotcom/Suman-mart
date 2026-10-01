import { NextRequest } from "next/server";
import { ok, resolveRange } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { getCampaigns } from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;
  const range = resolveRange(new URL(req.url));
  return ok(await getCampaigns(range));
}
