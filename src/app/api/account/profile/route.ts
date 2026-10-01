import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { getCurrentCustomer, getCustomerSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { z } from "zod";

export async function GET(_req: NextRequest) {
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);
  const { passwordHash: _ph, ...safe } = customer as { passwordHash?: string } & typeof customer;
  return ok(safe);
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const session = await getCustomerSession();
  if (!session) return fail("Authentication required", 401);

  const schema = z.object({
    name: z.string().min(2).max(80).optional(),
    phone: z.string().regex(/^01[3-9]\d{8}$/).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).max(100).optional(),
  });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input", 422);
  const { name, phone, currentPassword, newPassword } = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: session.id } });
  if (!customer) return fail("Account not found", 404);

  const data: Record<string, string | number> = {};
  if (name) data.name = name;
  if (phone) data.phone = phone;
  if (newPassword) {
    if (!currentPassword || !(await verifyPassword(currentPassword, customer.passwordHash))) {
      return fail("Current password is incorrect", 403);
    }
    if (await verifyPassword(newPassword, customer.passwordHash)) {
      return fail("The new password must be different from the current one", 422);
    }
    data.passwordHash = await hashPassword(newPassword);
    // Revoke every active session; the client re-signs in with the new password
    data.tokenVersion = customer.tokenVersion + 1;
  }
  if (Object.keys(data).length === 0) return fail("Nothing to update", 422);

  await db.customer.update({ where: { id: customer.id }, data });
  return ok({ updated: true, passwordChanged: Boolean(newPassword) });
}
