import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/auth";

export async function GET(_req: NextRequest) {
  const customer = await getCurrentCustomer();
  return ok({ customer });
}
