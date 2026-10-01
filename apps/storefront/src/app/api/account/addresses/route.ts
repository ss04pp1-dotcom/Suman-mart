import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/auth";
import { addressSchema } from "@/lib/validators";

export async function GET(_req: NextRequest) {
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);
  const addresses = await db.address.findMany({
    where: { customerId: customer.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return ok(addresses);
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const customer = await getCurrentCustomer();
  if (!customer) return fail("Authentication required", 401);

  const body = await req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid address", 422);

  const existingCount = await db.address.count({ where: { customerId: customer.id } });
  const isDefault = existingCount === 0 || (body?.isDefault === true);

  if (isDefault) {
    await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
  }

  const address = await db.address.create({
    data: { ...parsed.data, customerId: customer.id, isDefault },
  });
  return ok(address);
}
