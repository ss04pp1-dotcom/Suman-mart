import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { db } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { hasPermission, ROLE_PERMISSIONS, ROLE_LABELS, type AdminRole } from "@/lib/permissions";
import { parseJSON } from "@/lib/json";

export async function GET(_req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return ok({ admin: null });
  const overrides = parseJSON<string[] | null>(admin.permissions, null);
  const rolePerms = ROLE_PERMISSIONS[admin.role as AdminRole] ?? [];
  // Unused one-time recovery codes — surfaced so the Security page can nag
  // the admin when the set runs low (each code works exactly once).
  const recoveryCodesRemaining = admin.totpEnabled
    ? await db.adminRecoveryCode.count({ where: { adminId: admin.id, usedAt: null } })
    : 0;
  return ok({
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      roleLabel: ROLE_LABELS[admin.role as AdminRole] ?? admin.role,
      avatarUrl: admin.avatarUrl,
      mustChangePassword: admin.mustChangePassword,
      totpEnabled: admin.totpEnabled,
      recoveryCodesRemaining,
      permissions: rolePerms,
      permissionOverrides: overrides,
      can: (perm: string) => hasPermission(admin.role, perm as never, overrides),
    },
  });
}
