import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/auth";
import { addressSchema } from "@/lib/validators";

async function ownedAddress(customerId: string, id: string) {
  return db.address.findFirst({ where: { id, customerId } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);
  const { id } = await params;

  const existing = await ownedAddress(customer.id, id);
  if (!existing) return fail("Address not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid address", 422);

  if (body?.isDefault === true) {
    await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
  }

  const address = await db.address.update({
    where: { id },
    data: { ...parsed.data, isDefault: body?.isDefault ?? existing.isDefault },
  });
  return ok(address);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);
  const { id } = await params;

  const existing = await ownedAddress(customer.id, id);
  if (!existing) return fail("Address not found", 404);

  await db.address.delete({ where: { id } });
  return ok({ deleted: true });
}
