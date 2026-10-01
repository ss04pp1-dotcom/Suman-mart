import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { ROLE_PERMISSIONS, PERMISSIONS, type AdminRole, type Permission } from "@/lib/permissions";
import { stringifyJSON } from "@/lib/json";
import { z } from "zod";
import { NextResponse } from "next/server";

const permissionList = z.string().refine((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p), {
  message: "Unknown permission",
});

// undefined = leave unchanged, null = clear, array = set (validated)
function parsePermissions(permissions: unknown): { ok: true; value: string[] | null | undefined } | { ok: false; error: string } {
  if (permissions === undefined) return { ok: true, value: undefined };
  if (permissions === null) return { ok: true, value: null };
  if (!Array.isArray(permissions)) return { ok: false, error: "permissions must be an array" };
  if (permissions.length > 0) {
    const check = z.array(permissionList).safeParse(permissions);
    if (!check.success) return { ok: false, error: check.error.issues[0]?.message ?? "Invalid permission" };
  }
  return { ok: true, value: permissions.length ? (permissions as string[]) : null };
}

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("team.manage");
  if (guard instanceof NextResponse) return guard;
  const admins = await db.admin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, permissions: true, totpEnabled: true },
  });
  return ok(admins.map((a) => ({
    ...a,
    permissions: a.permissions ? (JSON.parse(a.permissions) as string[] | null) : null,
  })));
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPPORT", "MARKETING"]),
  password: z.string().min(10, "Password must be at least 10 characters").max(100),
  permissions: z.array(z.string()).optional().nullable(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("team.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid team member", 422);

  const perms = parsePermissions(parsed.data.permissions);
  if (!perms.ok) return fail(perms.error, 422);

  if (await db.admin.findUnique({ where: { email: parsed.data.email.toLowerCase() } })) {
    return fail("An admin with this email already exists", 409);
  }

  const admin = await db.admin.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      passwordHash: await hashPassword(parsed.data.password),
      permissions: perms.value?.length ? stringifyJSON(perms.value) : null,
    },
  });
  await writeAudit(guard.admin.id, "team.member_created", "admin", admin.id, { email: admin.email, role: admin.role });
  return ok({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
}

const updateSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPPORT", "MARKETING"]).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional().nullable(),
  password: z.string().min(10, "Password must be at least 10 characters").max(100).optional(),
});

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("team.manage");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid update", 422);
  const input = parsed.data;

  const target = await db.admin.findUnique({ where: { id: input.id } });
  if (!target) return fail("Team member not found", 404);

  if (target.id === guard.admin.id && input.isActive === false) {
    return fail("You cannot deactivate your own account", 422);
  }

  // Protect the last active SUPER_ADMIN from demotion / deactivation
  const demotes = input.role && target.role === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN";
  const deactivates = input.isActive === false && target.isActive;
  if ((demotes || deactivates) && target.role === "SUPER_ADMIN") {
    const otherSuperAdmins = await db.admin.count({
      where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
    });
    if (otherSuperAdmins === 0) {
      return fail("This is the last active Super Admin — promote another Super Admin first", 422);
    }
  }

  const perms = parsePermissions(input.permissions);
  if (!perms.ok) return fail(perms.error, 422);

  // Password change / deactivation revokes existing sessions
  const revokeSessions = Boolean(input.password) || input.isActive === false;

  const admin = await db.admin.update({
    where: { id: target.id },
    data: {
      ...(input.role ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(perms.value !== undefined ? { permissions: perms.value?.length ? stringifyJSON(perms.value) : null } : {}),
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      ...(revokeSessions ? { tokenVersion: { increment: 1 } } : {}),
    },
  });
  await writeAudit(guard.admin.id, "team.member_updated", "admin", target.id, {
    role: admin.role,
    fields: Object.keys(input).filter((k) => k !== "password"),
    sessionsRevoked: revokeSessions,
  });
  return ok({ id: admin.id, role: admin.role, isActive: admin.isActive });
}
