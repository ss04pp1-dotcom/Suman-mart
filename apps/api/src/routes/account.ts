// Customer account endpoints — Hono port of
// apps/storefront/src/app/api/account/* (profile, addresses CRUD, orders).

import { Hono } from "hono";
import type { Env } from "../env";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin, pageParams, paginated } from "@/lib/api";
import { getCurrentCustomer, getCustomerSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { addressSchema } from "@/lib/validators";
import { z } from "zod";

export const accountApi = new Hono<{ Bindings: Env }>();

// GET /v1/account/profile
accountApi.get("/profile", async (c) => {
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);
  const { passwordHash: _ph, ...safe } = customer as { passwordHash?: string } & typeof customer;
  return ok(c, safe);
});

// PUT /v1/account/profile
accountApi.put("/profile", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const session = await getCustomerSession(c.req.raw);
  if (!session) return fail(c, "Authentication required", 401);

  const schema = z.object({
    name: z.string().min(2).max(80).optional(),
    phone: z.string().regex(/^01[3-9]\d{8}$/).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).max(100).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid input", 422);
  const { name, phone, currentPassword, newPassword } = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: session.id } });
  if (!customer) return fail(c, "Account not found", 404);

  const data: Record<string, string | number> = {};
  if (name) data.name = name;
  if (phone) data.phone = phone;
  if (newPassword) {
    if (!currentPassword || !(await verifyPassword(currentPassword, customer.passwordHash))) {
      return fail(c, "Current password is incorrect", 403);
    }
    if (await verifyPassword(newPassword, customer.passwordHash)) {
      return fail(c, "The new password must be different from the current one", 422);
    }
    data.passwordHash = await hashPassword(newPassword);
    // Revoke every active session; the client re-signs in with the new password
    data.tokenVersion = customer.tokenVersion + 1;
  }
  if (Object.keys(data).length === 0) return fail(c, "Nothing to update", 422);

  await db.customer.update({ where: { id: customer.id }, data });
  return ok(c, { updated: true, passwordChanged: Boolean(newPassword) });
});

// GET /v1/account/addresses
accountApi.get("/addresses", async (c) => {
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);
  const addresses = await db.address.findMany({
    where: { customerId: customer.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return ok(c, addresses);
});

// POST /v1/account/addresses
accountApi.post("/addresses", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);

  const body = await c.req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid address", 422);

  const existingCount = await db.address.count({ where: { customerId: customer.id } });
  const isDefault = existingCount === 0 || (body?.isDefault === true);

  if (isDefault) {
    await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
  }

  const address = await db.address.create({
    data: { ...parsed.data, customerId: customer.id, isDefault },
  });
  return ok(c, address);
});

// PUT /v1/account/addresses/:id
accountApi.put("/addresses/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);
  const id = c.req.param("id");

  const existing = await db.address.findFirst({ where: { id, customerId: customer.id } });
  if (!existing) return fail(c, "Address not found", 404);

  const body = await c.req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid address", 422);

  if (body?.isDefault === true) {
    await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
  }

  const address = await db.address.update({
    where: { id },
    data: { ...parsed.data, isDefault: body?.isDefault ?? existing.isDefault },
  });
  return ok(c, address);
});

// DELETE /v1/account/addresses/:id
accountApi.delete("/addresses/:id", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);
  const id = c.req.param("id");

  const existing = await db.address.findFirst({ where: { id, customerId: customer.id } });
  if (!existing) return fail(c, "Address not found", 404);

  await db.address.delete({ where: { id } });
  return ok(c, { deleted: true });
});

// GET /v1/account/orders
accountApi.get("/orders", async (c) => {
  const customer = await getCurrentCustomer(c.req.raw);
  if (!customer) return fail(c, "Authentication required", 401);

  const url = new URL(c.req.url);
  const { page, limit, skip, take } = pageParams(url, 10);

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        items: { select: { name: true, imageUrl: true, quantity: true, total: true } },
      },
    }),
    db.order.count({ where: { customerId: customer.id } }),
  ]);

  return ok(
    c,
    paginated(
      orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        createdAt: o.createdAt,
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
        firstItems: o.items.slice(0, 3),
      })),
      total,
      page,
      limit
    )
  );
});
