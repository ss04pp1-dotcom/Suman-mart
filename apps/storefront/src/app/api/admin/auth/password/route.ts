import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAdminSelf } from "@/lib/admin-auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, "New password must be at least 10 characters").max(100),
});

/** Change the signed-in admin's own password (also clears mustChangePassword). */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdminSelf();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input", 422);

  const admin = await db.admin.findUnique({ where: { id: guard.adminId } });
  if (!admin) return fail("Admin account not found", 404);

  if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return fail("Current password is incorrect", 403);
  }
  if (await verifyPassword(parsed.data.newPassword, admin.passwordHash)) {
    return fail("The new password must be different from the current one", 422);
  }

  // Password change revokes all other sessions, then re-issues this one
  await db.admin.update({
    where: { id: admin.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });
  await writeAudit(admin.id, "admin.password_changed", "admin", admin.id, {});

  return ok({ changed: true });
}
