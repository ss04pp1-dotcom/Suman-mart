import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { saveUpload } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdmin("products.manage");
  if (guard instanceof NextResponse) return guard;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const folder = String(form?.get("folder") ?? "products");

  if (!(file instanceof File)) return fail("No file provided", 422);
  if (!["products", "banners", "categories", "misc"].includes(folder)) return fail("Invalid folder", 422);

  try {
    const url = await saveUpload(file, folder);
    await writeAudit(guard.admin.id, "image.uploaded", "storage", null, { folder, name: file.name });
    return ok({ url });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Upload failed", 400);
  }
}
