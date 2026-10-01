import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { authenticateAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { parseJSON } from "@/lib/json";
import { adminLoginSchema } from "@/lib/validators";
import { z } from "zod";

const schema = adminLoginSchema.extend({
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  // One-time recovery code (XXXX-XXXX-XXXX-XXXX) — alternative to the TOTP
  // code when the authenticator device is lost.
  recoveryCode: z.string().min(8).max(32).optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Enter a valid email and password", 422);

  const result = await authenticateAdmin(parsed.data.email, parsed.data.password, parsed.data.totpCode, parsed.data.recoveryCode);
  if ("totpRequired" in result && result.totpRequired) {
    return ok({ totpRequired: true });
  }
  if ("error" in result && result.error) return fail(result.error, result.status);

  const admin = await db.admin.findUnique({ where: { id: result.admin.id } });
  return ok({
    id: result.admin.id,
    name: result.admin.name,
    email: result.admin.email,
    role: result.admin.role,
    mustChangePassword: result.mustChangePassword ?? false,
    permissions: parseJSON<string[] | null>(admin?.permissions, null),
  });
}
