import { NextRequest } from "next/server";
import { ok, resolveRange } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getOverviewKPIs, getDailySeries, getTrafficSources, getDeviceBreakdown,
  getBrowserStats, getGeoStats, getEventCounts,
} from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin("analytics.view");
  if (guard instanceof NextResponse) return guard;

  const range = resolveRange(new URL(req.url));
  const [kpis, series, sources, devices, browsers, geo, eventCounts] = await Promise.all([
    getOverviewKPIs(range),
    getDailySeries(range),
    getTrafficSources(range),
    getDeviceBreakdown(range),
    getBrowserStats(range),
    getGeoStats(range),
    getEventCounts(range),
  ]);

  return ok({ range: { from: range.from, to: range.to, key: range.key }, kpis, series, sources, devices, ...browsers, geo, eventCounts });
}
