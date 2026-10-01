import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { destroyAdminSession, getAdminSession } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const session = await getAdminSession();
  if (session) await writeAudit(session.id, "admin.logout", "admin", session.id);
  await destroyAdminSession();
  return ok({ loggedOut: true });
}
