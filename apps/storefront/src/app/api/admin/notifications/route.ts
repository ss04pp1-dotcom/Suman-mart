import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, sameOrigin, fail } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("dashboard.view");
  if (guard instanceof NextResponse) return guard;

  const [notifications, unread] = await Promise.all([
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.notification.count({ where: { isRead: false } }),
  ]);
  return ok({ notifications, unread });
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("dashboard.view");
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const { id, all } = body ?? {};
  if (all) {
    await db.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
    return ok({ updated: "all" });
  }
  if (!id) return fail("Notification ID required", 422);
  await db.notification.update({ where: { id }, data: { isRead: true } });
  return ok({ updated: id });
}
