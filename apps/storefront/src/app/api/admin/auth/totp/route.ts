import { NextRequest } from "next/server";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAdminSelf } from "@/lib/admin-auth";
import { generateTotpSecret, totpUri, verifyTotpStep, encryptTotpSecret, decryptTotpSecret } from "@/lib/totp";
import { generateRecoveryCodes, normalizeRecoveryCode, recoveryCodeHash } from "@/lib/recovery";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";
import { NextResponse } from "next/server";

const schema = z.object({
  action: z.enum(["setup", "enable", "disable", "regenerate-recovery"]),
  code: z.string().max(32).optional(),
});

/**
 * Self-service TOTP two-factor management for the signed-in admin.
 *
 * Recovery codes (round 3): enabling 2FA mints 8 one-time codes that are
 * returned EXACTLY ONCE — they are the escape hatch when the authenticator
 * device is lost. `regenerate-recovery` accepts a current TOTP code or a
 * still-unused recovery code (the admin may have just logged in with one).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const guard = await requireAdminSelf();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 422);
  const { action, code } = parsed.data;

  const admin = await db.admin.findUnique({ where: { id: guard.adminId } });
  if (!admin) return fail("Admin account not found", 404);

  /** Replace all recovery codes with a fresh set; returns the PLAINTEXT codes once. */
  const mintRecoveryCodes = async (): Promise<string[]> => {
    const codes = generateRecoveryCodes();
    await db.$transaction([
      db.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } }),
      db.adminRecoveryCode.createMany({
        data: await Promise.all(
          codes.map(async (c) => ({
            adminId: admin.id,
            lookupHash: await recoveryCodeHash(normalizeRecoveryCode(c)),
          }))
        ),
      }),
    ]);
    return codes;
  };

  if (action === "setup") {
    if (admin.totpEnabled) return fail("Two-factor authentication is already enabled", 422);
    const secret = generateTotpSecret();
    // Store encrypted at rest; the PLAINTEXT secret is returned exactly once
    // so the owner can render the QR code.
    await db.admin.update({
      where: { id: admin.id },
      data: { totpSecret: await encryptTotpSecret(secret), totpEnabled: false, totpLastStep: null },
    });
    return ok({ secret, uri: totpUri(secret, admin.email, "ShopNest Admin") });
  }

  if (action === "enable") {
    if (!admin.totpSecret) return fail("Start the setup first", 422);
    if (admin.totpEnabled) return fail("Two-factor authentication is already enabled", 422);
    const secret = await decryptTotpSecret(admin.totpSecret);
    const step = secret ? await verifyTotpStep(secret, (code ?? "").replace(/\D/g, "")) : null;
    if (!code || step === null) {
      return fail("Invalid code — check your authenticator app and try again", 422);
    }
    // Remember the consumed step so this code cannot be replayed at login.
    await db.admin.update({ where: { id: admin.id }, data: { totpEnabled: true, totpLastStep: step } });
    // Recovery codes are minted now and shown EXACTLY ONCE.
    const recoveryCodes = await mintRecoveryCodes();
    await writeAudit(admin.id, "admin.totp_enabled", "admin", admin.id, {});
    return ok({ enabled: true, recoveryCodes });
  }

  if (action === "regenerate-recovery") {
    if (!admin.totpEnabled || !admin.totpSecret) return fail("Enable two-factor authentication first", 422);
    // Accept a current TOTP code OR a still-unused recovery code (device lost
    // → admin logs in with a recovery code → regenerates immediately).
    const trimmed = (code ?? "").trim();
    const sixDigits = /^\d{6}$/.test(trimmed);
    let authorized = false;
    if (sixDigits) {
      const secret = await decryptTotpSecret(admin.totpSecret);
      authorized = secret ? (await verifyTotpStep(secret, trimmed)) !== null : false;
    } else if (trimmed) {
      const row = await db.adminRecoveryCode.findUnique({
        where: { lookupHash: await recoveryCodeHash(normalizeRecoveryCode(trimmed)) },
      });
      authorized = Boolean(row && row.adminId === admin.id && !row.usedAt);
    }
    if (!authorized) {
      return fail("Enter a current 6-digit code (or an unused recovery code) to regenerate", 422);
    }
    const recoveryCodes = await mintRecoveryCodes();
    await writeAudit(admin.id, "admin.recovery_codes_regenerated", "admin", admin.id, {});
    return ok({ recoveryCodes });
  }

  // disable
  if (!admin.totpEnabled) return fail("Two-factor authentication is not enabled", 422);
  const secret = admin.totpSecret ? await decryptTotpSecret(admin.totpSecret) : "";
  if (!secret || !code || (await verifyTotpStep(secret, code)) === null) {
    return fail("Invalid code — enter a current code to disable 2FA", 422);
  }
  await db.$transaction([
    db.admin.update({ where: { id: admin.id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null } }),
    db.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } }),
  ]);
  await writeAudit(admin.id, "admin.totp_disabled", "admin", admin.id, {});
  return ok({ enabled: false });
}
