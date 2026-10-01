import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { ipRateLimit } from "@/lib/rate-limit";
import { redeemAuthToken } from "@/lib/auth-tokens";
import { z } from "zod";

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const rl = await ipRateLimit("reset", 10, 15 * 60_000, req);
  if (!rl.ok) return fail("Too many attempts. Please try again later.", 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid reset request", 422);

  const customerId = await redeemAuthToken("PASSWORD_RESET", parsed.data.token);
  if (!customerId) return fail("This reset link is invalid or has expired. Please request a new one.", 422);

  // Password change revokes every active session (tokenVersion bump)
  await db.customer.update({
    where: { id: customerId },
    data: { passwordHash: await hashPassword(parsed.data.password), tokenVersion: { increment: 1 } },
  });

  return ok({ message: "Your password has been reset. Please sign in with the new password." });
}
