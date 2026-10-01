import { NextRequest } from "next/server";
import { ok, sameOrigin, fail } from "@/lib/api";
import { destroyCustomerSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  await destroyCustomerSession();
  return ok({ loggedOut: true });
}
