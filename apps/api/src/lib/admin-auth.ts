// Admin sessions + authentication — ported from apps/storefront
// src/lib/admin-auth.ts. Identical security model:
//   • PBKDF2-600k password verify (+ transparent rehash upgrade)
//   • per-IP login rate limit, per-EMAIL 2FA lockout
//   • TOTP (encrypted at rest, replay-protected by consumed time-step) OR
//     one-time recovery codes (hashed, atomic claim)
//   • audit trail on every outcome
// The only change: sessions/cookies are written via Hono, guards throw
// HttpError (mapped to the standard JSON envelope by app.onError), and the
// request for IP limiting is passed explicitly.

import type { Context } from "hono";
import { db } from "@/lib/db";
import { signJWT, verifyJWT } from "@/lib/jwt";
import { hasPermission, type Permission } from "@/lib/permissions";
import { parseJSON } from "@/lib/json";
import { ipRateLimit, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { httpFail } from "@/lib/http";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/password";
import { verifyTotpStep, decryptTotpSecret, encryptTotpSecret, needsTotpSecretUpgrade } from "@/lib/totp";
import { normalizeRecoveryCode, looksLikeRecoveryCode, recoveryCodeHash } from "@/lib/recovery";
import { writeAudit } from "@/lib/audit";
import { serializeCookie, getCookie } from "@/lib/cookies";
import { runtimeEnv } from "@/lib/config";

export const ADMIN_COOKIE = "sn_admin";
const MAX_AGE = 60 * 60 * 8; // 8 hours

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: string;
}

function secureCookies(): boolean {
  return runtimeEnv().NODE_ENV === "production";
}

export async function createAdminSession(c: Context, admin: AdminSession & { tokenVersion?: number }) {
  const token = await signJWT(
    { sub: admin.id, name: admin.name, email: admin.email, role: admin.role, typ: "admin", tv: admin.tokenVersion ?? 0 },
    runtimeEnv().ADMIN_SESSION_SECRET!
  );
  c.header(
    "Set-Cookie",
    serializeCookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: MAX_AGE,
    }),
    { append: true }
  );
}

export async function destroyAdminSession(c: Context) {
  c.header(
    "Set-Cookie",
    serializeCookie(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 }),
    { append: true }
  );
}

export async function getAdminSession(req: Request): Promise<AdminSession | null> {
  const token = getCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const payload = await verifyJWT(token, runtimeEnv().ADMIN_SESSION_SECRET!);
  if (!payload || payload.typ !== "admin") return null;

  // Verify against DB: account must exist, be active and the tokenVersion in
  // the JWT must match (password change / deactivation revokes old tokens).
  const admin = await db.admin.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true, isActive: true, tokenVersion: true },
  });
  if (!admin || !admin.isActive) return null;
  if (admin.tokenVersion !== (typeof payload.tv === "number" ? payload.tv : 0)) return null;

  return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
}

/** Full admin record incl. permission overrides (server-side only). */
export async function getCurrentAdmin(req: Request) {
  const session = await getAdminSession(req);
  if (!session) return null;
  const admin = await db.admin.findFirst({
    where: { id: session.id, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      avatarUrl: true,
      lastLoginAt: true,
      mustChangePassword: true,
      totpEnabled: true,
    },
  });
  return admin;
}

/**
 * Guard for admin API handlers. Usage:
 *   const { admin } = await requireAdmin(c, "products.manage");
 * Failures throw HttpError → the standard error envelope (401/403), exactly
 * like the monolith's `fail(...)` returns.
 *
 * Admins flagged `mustChangePassword` are locked out of everything except
 * changing their own password (see /v1/admin/auth/password).
 */
export async function requireAdmin(
  c: Context,
  permission?: Permission
): Promise<{ admin: { id: string; name: string; email: string; role: string; permissions: string[] | null } }> {
  const session = await getAdminSession(c.req.raw);
  if (!session) httpFail(401, "Authentication required");
  const admin = await db.admin.findFirst({
    where: { id: session.id, isActive: true },
    select: { id: true, name: true, email: true, role: true, permissions: true, mustChangePassword: true },
  });
  if (!admin) httpFail(401, "Admin account not found or inactive");
  if (admin.mustChangePassword) {
    httpFail(403, "You must change your password before using the console", { code: "MUST_CHANGE_PASSWORD" });
  }
  if (permission && !hasPermission(admin.role, permission, parseJSON<string[] | null>(admin.permissions, null))) {
    httpFail(403, "You do not have permission to perform this action");
  }
  return {
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: parseJSON<string[] | null>(admin.permissions, null),
    },
  };
}

/**
 * Authenticated-admin guard WITHOUT permission / mustChangePassword checks —
 * for the password-change and self-info endpoints only.
 */
export async function requireAdminSelf(c: Context): Promise<{ adminId: string }> {
  const session = await getAdminSession(c.req.raw);
  if (!session) httpFail(401, "Authentication required");
  return { adminId: session.id };
}

/** Verify admin credentials with rate limiting + audit trail + optional TOTP / recovery code. */
export async function authenticateAdmin(
  c: Context,
  email: string,
  password: string,
  totpCode?: string,
  recoveryCode?: string
) {
  const rl = await ipRateLimit("admin-login", 8, 5 * 60_000, c.req.raw);
  if (!rl.ok) return { error: "Too many attempts. Please try again in a few minutes.", status: 429 } as const;

  const admin = await db.admin.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!admin || !admin.isActive) {
    await writeAudit(null, "admin.login.failed", "admin", email, { email, reason: "not_found" });
    return { error: "Invalid email or password", status: 401 } as const;
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "bad_password" });
    return { error: "Invalid email or password", status: 401 } as const;
  }

  // Two-factor authentication: a current TOTP code OR a one-time recovery
  // code (recovery codes exist so a lost authenticator never locks the
  // admin out of the console — round-3 audit finding).
  if (admin.totpEnabled && admin.totpSecret) {
    if (!totpCode && !recoveryCode) return { totpRequired: true } as const;

    // Per-EMAIL lockout: an attacker rotating IPs (forged XFF / botnets)
    // cannot dodge this bucket — it is keyed on the actual target account.
    const emailLock = await rateLimit(`admin-totp:${admin.email}`, 8, 15 * 60_000);
    if (!emailLock.ok) {
      await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "totp_lockout" });
      return { error: "Too many two-factor attempts. Please try again in 15 minutes.", status: 429 } as const;
    }

    if (recoveryCode) {
      // ── One-time recovery code path ──
      const normalized = normalizeRecoveryCode(recoveryCode);
      if (!looksLikeRecoveryCode(recoveryCode)) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "bad_recovery_format" });
        return { error: "Invalid recovery code", status: 401 } as const;
      }
      const hash = await recoveryCodeHash(normalized);
      const row = await db.adminRecoveryCode.findUnique({ where: { lookupHash: hash } });
      if (!row || row.adminId !== admin.id) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "bad_recovery_code" });
        return { error: "Invalid recovery code", status: 401 } as const;
      }
      if (row.usedAt) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "recovery_code_replay" });
        return { error: "That recovery code was already used — each code works exactly once.", status: 401 } as const;
      }
      // Atomic claim: two racing requests can never both spend one code.
      const claim = await db.adminRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claim.count === 0) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "recovery_code_replay" });
        return { error: "That recovery code was already used — each code works exactly once.", status: 401 } as const;
      }
      await writeAudit(admin.id, "admin.login.recovery_code", "admin", admin.id, { email: admin.email });
    } else {
      // ── TOTP code path ──
      const secret = await decryptTotpSecret(admin.totpSecret);
      const step = secret ? await verifyTotpStep(secret, totpCode ?? "") : null;
      if (step === null) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "bad_totp" });
        return { error: "Invalid two-factor code", status: 401 } as const;
      }

      // Replay protection: the step must be NEWER than the last consumed one,
      // and the claim is atomic — two racing requests with the same code cannot
      // both win (the loser's conditional update matches 0 rows).
      const claim = await db.admin.updateMany({
        where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (claim.count === 0) {
        await writeAudit(admin.id, "admin.login.failed", "admin", admin.id, { email, reason: "totp_replay" });
        return { error: "This code was already used — wait for the next one and try again.", status: 401 } as const;
      }
    }

    // Transparent upgrade of the stored secret to the CURRENT encryption
    // version (legacy plaintext → v1; v1 → v2 once TOTP_ENC_KEY is set).
    if (needsTotpSecretUpgrade(admin.totpSecret)) {
      const secret = await decryptTotpSecret(admin.totpSecret);
      if (secret) {
        await db.admin
          .update({ where: { id: admin.id }, data: { totpSecret: await encryptTotpSecret(secret) } })
          .catch(() => undefined);
      }
    }

    // Successful 2FA clears the per-email failure window.
    await resetRateLimit(`admin-totp:${admin.email}`);
  }

  // Transparent upgrade of outdated password hashes (e.g. 100k → 600k iterations)
  if (needsRehash(admin.passwordHash)) {
    await db.admin
      .update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password) } })
      .catch(() => undefined);
  }

  await db.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await createAdminSession(c, { id: admin.id, name: admin.name, email: admin.email, role: admin.role, tokenVersion: admin.tokenVersion });
  await writeAudit(admin.id, "admin.login", "admin", admin.id, { email: admin.email });
  return { admin, mustChangePassword: admin.mustChangePassword } as const;
}
