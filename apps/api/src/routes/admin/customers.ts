// Admin customers + team management — Hono port of
// apps/storefront/src/app/api/admin/customers/* and admin/team/route.ts.

import { Hono } from "hono";
import type { Env } from "../../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin, pageParams, paginated } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { ROLE_PERMISSIONS, PERMISSIONS, type AdminRole, type Permission } from "@/lib/permissions";
import { stringifyJSON } from "@/lib/json";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

// ── Customers ──────────────────────────────────────────────────────

export const adminCustomersApi = new Hono<{ Bindings: Env }>();

adminCustomersApi.get("/", async (c) => {
  await requireAdmin(c, "customers.view");

  const url = new URL(c.req.url);
  const { page, limit, skip, take } = pageParams(url, 15);
  const q = url.searchParams.get("q")?.trim();

  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] }
    : {};

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, name: true, email: true, phone: true, createdAt: true, isActive: true,
        orders: { select: { total: true, createdAt: true, status: true } },
      },
    }),
    db.customer.count({ where }),
  ]);

  return ok(
    c,
    paginated(
      customers.map((cust) => {
        const valid = cust.orders.filter((o) => o.status !== "CANCELLED");
        return {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          phone: cust.phone,
          createdAt: cust.createdAt,
          isActive: cust.isActive,
          totalOrders: valid.length,
          totalSpent: valid.reduce((s, o) => s + o.total, 0),
          lastOrderAt: valid.length ? valid.map((o) => o.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] : null,
        };
      }),
      total,
      page,
      limit
    )
  );
});

adminCustomersApi.get("/:id", async (c) => {
  await requireAdmin(c, "customers.view");
  const id = c.req.param("id");

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      addresses: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, orderNumber: true, status: true, paymentStatus: true, total: true, createdAt: true,
          items: { select: { name: true, quantity: true } },
        },
      },
      reviews: { orderBy: { createdAt: "desc" }, take: 10, select: { rating: true, comment: true, createdAt: true, product: { select: { name: true } } } },
    },
  });
  if (!customer) return fail(c, "Customer not found", 404);

  // Only non-sensitive fields (no password hash exposure)
  const valid = customer.orders.filter((o) => o.status !== "CANCELLED");
  return ok(c, {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl,
    createdAt: customer.createdAt,
    isActive: customer.isActive,
    addresses: customer.addresses,
    orders: customer.orders,
    reviews: customer.reviews,
    summary: {
      totalOrders: valid.length,
      totalSpent: valid.reduce((s, o) => s + o.total, 0),
      aov: valid.length ? Math.round(valid.reduce((s, o) => s + o.total, 0) / valid.length) : 0,
      lastOrderAt: valid.length ? valid[0].createdAt : null,
    },
  });
});

adminCustomersApi.put("/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "customers.manage");
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ isActive: z.boolean() }).safeParse(body);
  if (!parsed.success) return fail(c, "isActive (boolean) is required", 422);

  const target = await db.customer.findUnique({ where: { id } });
  if (!target) return fail(c, "Customer not found", 404);

  const customer = await db.customer.update({
    where: { id },
    data: {
      isActive: parsed.data.isActive,
      // Deactivation revokes every active session (tokenVersion bump)
      ...(parsed.data.isActive === false ? { tokenVersion: { increment: 1 } } : {}),
    },
  });
  await writeAudit(guard.admin.id, parsed.data.isActive ? "customer.reactivated" : "customer.deactivated", "customer", id, { email: customer.email });
  return ok(c, { id: customer.id, isActive: customer.isActive });
});

// ── Team (admin accounts) ──────────────────────────────────────────

export const adminTeamApi = new Hono<{ Bindings: Env }>();

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

adminTeamApi.get("/", async (c) => {
  await requireAdmin(c, "team.manage");
  void ROLE_PERMISSIONS;
  const admins = await db.admin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, permissions: true, totpEnabled: true },
  });
  return ok(c, admins.map((a) => ({
    ...a,
    permissions: a.permissions ? (JSON.parse(a.permissions) as string[] | null) : null,
  })));
});

adminTeamApi.post("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "team.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      name: z.string().min(2).max(80),
      email: z.string().email(),
      role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPPORT", "MARKETING"]),
      password: z.string().min(10, "Password must be at least 10 characters").max(100),
      permissions: z.array(z.string()).optional().nullable(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid team member", 422);

  const perms = parsePermissions(parsed.data.permissions);
  if (!perms.ok) return fail(c, perms.error, 422);

  if (await db.admin.findUnique({ where: { email: parsed.data.email.toLowerCase() } })) {
    return fail(c, "An admin with this email already exists", 409);
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
  return ok(c, { id: admin.id, name: admin.name, email: admin.email, role: admin.role });
});

adminTeamApi.put("/", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdmin(c, "team.manage");

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      id: z.string().min(1),
      role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPPORT", "MARKETING"]).optional(),
      isActive: z.boolean().optional(),
      permissions: z.array(z.string()).optional().nullable(),
      password: z.string().min(10, "Password must be at least 10 characters").max(100).optional(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid update", 422);
  const input = parsed.data;

  const target = await db.admin.findUnique({ where: { id: input.id } });
  if (!target) return fail(c, "Team member not found", 404);

  if (target.id === guard.admin.id && input.isActive === false) {
    return fail(c, "You cannot deactivate your own account", 422);
  }

  // Protect the last active SUPER_ADMIN from demotion / deactivation
  const demotes = input.role && target.role === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN";
  const deactivates = input.isActive === false && target.isActive;
  if ((demotes || deactivates) && target.role === "SUPER_ADMIN") {
    const otherSuperAdmins = await db.admin.count({
      where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
    });
    if (otherSuperAdmins === 0) {
      return fail(c, "This is the last active Super Admin — promote another Super Admin first", 422);
    }
  }

  const perms = parsePermissions(input.permissions);
  if (!perms.ok) return fail(c, perms.error, 422);

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
  return ok(c, { id: admin.id, role: admin.role, isActive: admin.isActive });
});
