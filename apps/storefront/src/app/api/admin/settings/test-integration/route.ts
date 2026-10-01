import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { testIntegration, type PixelProvider } from "@/lib/pixels";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("tracking.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = z.object({ provider: z.enum(["META", "GOOGLE", "TIKTOK", "CUSTOM"]) }).safeParse(body);
  if (!parsed.success) return fail("Invalid provider", 422);

  const result = await testIntegration(parsed.data.provider as PixelProvider);
  await writeAudit(guard.admin.id, "tracking.test_integration", "settings", parsed.data.provider, { ok: result.ok });
  return ok(result);
}
