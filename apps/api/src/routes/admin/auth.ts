// Admin authentication endpoints — Hono port of
// apps/storefront/src/app/api/admin/auth/* (login, logout, me, password, totp).
//
// The two $transaction([...]) blocks in the original totp route (recovery
// code mint + 2FA disable) run as atomic D1 batches here — the D1 adapter
// does not support array transactions.

import { Hono } from "hono";
import type { Env } from "../../env";
import { ok, fail, sameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { authenticateAdmin, destroyAdminSession, getAdminSession, getCurrentAdmin, requireAdminSelf } from "@/lib/admin-auth";
import { parseJSON } from "@/lib/json";
import { adminLoginSchema } from "@/lib/validators";
import { generateTotpSecret, totpUri, verifyTotpStep, encryptTotpSecret, decryptTotpSecret } from "@/lib/totp";
import { generateRecoveryCodes, normalizeRecoveryCode, recoveryCodeHash } from "@/lib/recovery";
import { hashPassword, verifyPassword } from "@/lib/password";
import { writeAudit } from "@/lib/audit";
import { sqlDate } from "@/lib/config";
import { hasPermission, ROLE_PERMISSIONS, ROLE_LABELS, type AdminRole } from "@/lib/permissions";
import { z } from "zod";

export const adminAuthApi = new Hono<{ Bindings: Env }>();

// POST /v1/admin/auth/login
adminAuthApi.post("/login", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);

  const body = await c.req.json().catch(() => null);
  const parsed = adminLoginSchema
    .extend({
      totpCode: z.string().regex(/^\d{6}$/).optional(),
      // One-time recovery code (XXXX-XXXX-XXXX-XXXX) — alternative to the TOTP
      // code when the authenticator device is lost.
      recoveryCode: z.string().min(8).max(32).optional(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, "Enter a valid email and password", 422);

  const result = await authenticateAdmin(c, parsed.data.email, parsed.data.password, parsed.data.totpCode, parsed.data.recoveryCode);
  if ("totpRequired" in result && result.totpRequired) {
    return ok(c, { totpRequired: true });
  }
  if ("error" in result && result.error) return fail(c, result.error, result.status);

  const admin = await db.admin.findUnique({ where: { id: result.admin.id } });
  return ok(c, {
    id: result.admin.id,
    name: result.admin.name,
    email: result.admin.email,
    role: result.admin.role,
    mustChangePassword: result.mustChangePassword ?? false,
    permissions: parseJSON<string[] | null>(admin?.permissions, null),
  });
});

// POST /v1/admin/auth/logout
adminAuthApi.post("/logout", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const session = await getAdminSession(c.req.raw);
  if (session) await writeAudit(session.id, "admin.logout", "admin", session.id);
  await destroyAdminSession(c);
  return ok(c, { loggedOut: true });
});

// GET /v1/admin/auth/me
adminAuthApi.get("/me", async (c) => {
  const admin = await getCurrentAdmin(c.req.raw);
  if (!admin) return ok(c, { admin: null });
  const overrides = parseJSON<string[] | null>(admin.permissions, null);
  const rolePerms = ROLE_PERMISSIONS[admin.role as AdminRole] ?? [];
  // Unused one-time recovery codes — surfaced so the Security page can nag
  // the admin when the set runs low (each code works exactly once).
  const recoveryCodesRemaining = admin.totpEnabled
    ? await db.adminRecoveryCode.count({ where: { adminId: admin.id, usedAt: null } })
    : 0;
  return ok(c, {
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      roleLabel: ROLE_LABELS[admin.role as AdminRole] ?? admin.role,
      avatarUrl: admin.avatarUrl,
      mustChangePassword: admin.mustChangePassword,
      totpEnabled: admin.totpEnabled,
      recoveryCodesRemaining,
      permissions: rolePerms,
      permissionOverrides: overrides,
      can: (perm: string) => hasPermission(admin.role, perm as never, overrides),
    },
  });
});

// PUT /v1/admin/auth/password — change the signed-in admin's own password
// (also clears mustChangePassword).
adminAuthApi.put("/password", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdminSelf(c);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(10, "New password must be at least 10 characters").max(100),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid input", 422);

  const admin = await db.admin.findUnique({ where: { id: guard.adminId } });
  if (!admin) return fail(c, "Admin account not found", 404);

  if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return fail(c, "Current password is incorrect", 403);
  }
  if (await verifyPassword(parsed.data.newPassword, admin.passwordHash)) {
    return fail(c, "The new password must be different from the current one", 422);
  }

  // Password change revokes all other sessions, then re-issues this one
  await db.admin.update({
    where: { id: admin.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });
  await writeAudit(admin.id, "admin.password_changed", "admin", admin.id, {});

  return ok(c, { changed: true });
});

// POST /v1/admin/auth/totp — self-service TOTP two-factor management.
//
// Recovery codes (round 3): enabling 2FA mints 8 one-time codes that are
// returned EXACTLY ONCE — they are the escape hatch when the authenticator
// device is lost. `regenerate-recovery` accepts a current TOTP code or a
// still-unused recovery code (the admin may have just logged in with one).
adminAuthApi.post("/totp", async (c) => {
  if (!sameOrigin(c.req.raw)) return fail(c, "Invalid request origin", 403);
  const guard = await requireAdminSelf(c);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      action: z.enum(["setup", "enable", "disable", "regenerate-recovery"]),
      code: z.string().max(32).optional(),
    })
    .safeParse(body);
  if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid request", 422);
  const { action, code } = parsed.data;

  const admin = await db.admin.findUnique({ where: { id: guard.adminId } });
  if (!admin) return fail(c, "Admin account not found", 404);

  const d1 = () => {
    const env = (globalThis as unknown as { __apiEnv?: { DB: D1Database } }).__apiEnv;
    if (!env?.DB) throw new Error("totp route used before the env bridge ran");
    return env.DB;
  };
  const cuidLike = (prefix: string) =>
    `c${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 12)}${prefix}`;

  /** Replace all recovery codes with a fresh set (atomic batch); returns the PLAINTEXT codes once. */
  const mintRecoveryCodes = async (): Promise<string[]> => {
    const codes = generateRecoveryCodes();
    const rows = await Promise.all(
      codes.map(async (c2) => ({
        id: cuidLike("r"),
        adminId: admin.id,
        lookupHash: await recoveryCodeHash(normalizeRecoveryCode(c2)),
      }))
    );
    await d1().batch([
      d1().prepare(`DELETE FROM "AdminRecoveryCode" WHERE "adminId" = ?1`).bind(admin.id),
      ...rows.map((r) =>
        d1()
          .prepare(`INSERT INTO "AdminRecoveryCode" ("id", "adminId", "lookupHash", "usedAt", "createdAt") VALUES (?1, ?2, ?3, NULL, ?4)`)
          .bind(r.id, r.adminId, r.lookupHash, sqlDate(Date.now()))
      ),
    ]);
    return codes;
  };

  if (action === "setup") {
    if (admin.totpEnabled) return fail(c, "Two-factor authentication is already enabled", 422);
    const secret = generateTotpSecret();
    // Store encrypted at rest; the PLAINTEXT secret is returned exactly once
    // so the owner can render the QR code.
    await db.admin.update({
      where: { id: admin.id },
      data: { totpSecret: await encryptTotpSecret(secret), totpEnabled: false, totpLastStep: null },
    });
    return ok(c, { secret, uri: totpUri(secret, admin.email, "ShopNest Admin") });
  }

  if (action === "enable") {
    if (!admin.totpSecret) return fail(c, "Start the setup first", 422);
    if (admin.totpEnabled) return fail(c, "Two-factor authentication is already enabled", 422);
    const secret = await decryptTotpSecret(admin.totpSecret);
    const step = secret ? await verifyTotpStep(secret, (code ?? "").replace(/\D/g, "")) : null;
    if (!code || step === null) {
      return fail(c, "Invalid code — check your authenticator app and try again", 422);
    }
    // Remember the consumed step so this code cannot be replayed at login.
    await db.admin.update({ where: { id: admin.id }, data: { totpEnabled: true, totpLastStep: step } });
    // Recovery codes are minted now and shown EXACTLY ONCE.
    const recoveryCodes = await mintRecoveryCodes();
    await writeAudit(admin.id, "admin.totp_enabled", "admin", admin.id, {});
    return ok(c, { enabled: true, recoveryCodes });
  }

  if (action === "regenerate-recovery") {
    if (!admin.totpEnabled || !admin.totpSecret) return fail(c, "Enable two-factor authentication first", 422);
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
      return fail(c, "Enter a current 6-digit code (or an unused recovery code) to regenerate", 422);
    }
    const recoveryCodes = await mintRecoveryCodes();
    await writeAudit(admin.id, "admin.recovery_codes_regenerated", "admin", admin.id, {});
    return ok(c, { recoveryCodes });
  }

  // disable
  if (!admin.totpEnabled) return fail(c, "Two-factor authentication is not enabled", 422);
  const secret = admin.totpSecret ? await decryptTotpSecret(admin.totpSecret) : "";
  if (!secret || !code || (await verifyTotpStep(secret, code)) === null) {
    return fail(c, "Invalid code — enter a current code to disable 2FA", 422);
  }
  await d1().batch([
    d1().prepare(`UPDATE "Admin" SET "totpEnabled" = 0, "totpSecret" = NULL, "totpLastStep" = NULL, "updatedAt" = ?1 WHERE "id" = ?2`).bind(sqlDate(Date.now()), admin.id),
    d1().prepare(`DELETE FROM "AdminRecoveryCode" WHERE "adminId" = ?1`).bind(admin.id),
  ]);
  await writeAudit(admin.id, "admin.totp_disabled", "admin", admin.id, {});
  return ok(c, { enabled: false });
});
