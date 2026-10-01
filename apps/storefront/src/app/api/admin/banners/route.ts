import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { bannerSchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("banners.manage");
  if (guard instanceof NextResponse) return guard;
  const banners = await db.banner.findMany({ orderBy: [{ placement: "asc" }, { sortOrder: "asc" }] });
  const sections = await db.homepageSection.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ banners, sections });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("banners.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = bannerSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid banner", 422);
  const d = parsed.data;
  const banner = await db.banner.create({
    data: {
      title: d.title, subtitle: d.subtitle ?? null, imageUrl: d.imageUrl,
      buttonLabel: d.buttonLabel ?? null, buttonUrl: d.buttonUrl ?? null,
      placement: d.placement, theme: d.theme ?? "Dark", sortOrder: d.sortOrder ?? 0,
      startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
      endsAt: d.endsAt ? new Date(d.endsAt) : null,
      isActive: d.isActive ?? true,
    },
  });
  await writeAudit(guard.admin.id, "banner.created", "banner", banner.id, { title: banner.title });
  return ok(banner);
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("banners.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const { id, sectionId, ...rest } = body ?? {};

  // Homepage section toggling
  if (sectionId) {
    const section = await db.homepageSection.update({
      where: { key: sectionId },
      data: { isActive: rest.isActive },
    });
    await writeAudit(guard.admin.id, "homepage_section.updated", "homepage_section", sectionId, { isActive: rest.isActive });
    return ok(section);
  }

  if (!id) return fail("Banner ID required", 422);
  const parsed = bannerSchema.partial().safeParse(rest);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid banner", 422);
  const d = parsed.data;
  const banner = await db.banner.update({
    where: { id },
    data: {
      ...(d.title ? { title: d.title } : {}),
      ...(d.subtitle !== undefined ? { subtitle: d.subtitle } : {}),
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
      ...(d.buttonLabel !== undefined ? { buttonLabel: d.buttonLabel } : {}),
      ...(d.buttonUrl !== undefined ? { buttonUrl: d.buttonUrl } : {}),
      ...(d.placement ? { placement: d.placement } : {}),
      ...(d.theme ? { theme: d.theme } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...(d.startsAt ? { startsAt: new Date(d.startsAt) } : {}),
      ...(d.endsAt !== undefined ? { endsAt: d.endsAt ? new Date(d.endsAt) : null } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });
  await writeAudit(guard.admin.id, "banner.updated", "banner", id, { title: banner.title });
  return ok(banner);
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("banners.manage");
  if (guard instanceof NextResponse) return guard;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Banner ID required", 422);
  await db.banner.delete({ where: { id } });
  await writeAudit(guard.admin.id, "banner.deleted", "banner", id);
  return ok({ deleted: true });
}
