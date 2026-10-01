import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { categorySchema } from "@/lib/validators";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import { NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin("products.view");
  if (guard instanceof NextResponse) return guard;
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return ok(categories.map((c) => ({ ...c, productCount: c._count.products })));
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid category", 422);

  const slug = slugify(parsed.data.name);
  if (await db.category.findUnique({ where: { slug } })) return fail("Category already exists", 409);

  const category = await db.category.create({
    data: { ...parsed.data, slug, imageUrl: parsed.data.imageUrl || null },
  });
  await writeAudit(guard.admin.id, "category.created", "category", category.id, { name: category.name });
  return ok(category);
}

export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const { id, ...rest } = body ?? {};
  if (!id) return fail("Category ID required", 422);
  const parsed = categorySchema.partial().safeParse(rest);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid category", 422);

  const category = await db.category.update({ where: { id }, data: parsed.data });
  await writeAudit(guard.admin.id, "category.updated", "category", id, { name: category.name });
  return ok(category);
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Category ID required", 422);

  const count = await db.product.count({ where: { categoryId: id } });
  if (count > 0) return fail(`Cannot delete — ${count} product(s) use this category`, 409);

  await db.category.delete({ where: { id } });
  await writeAudit(guard.admin.id, "category.deleted", "category", id);
  return ok({ deleted: true });
}
