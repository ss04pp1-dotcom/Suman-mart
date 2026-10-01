// E2E helper: set a known password for the sandbox admin account.
//
// SAFEGUARDS (round-4 audit — this script once carried a committed default
// password and a hardcoded sandbox path; if run by mistake against a
// production database it would stamp a PUBLICLY KNOWN password onto the
// admin account):
//   1. Refuses to run when NODE_ENV=production.
//   2. Requires an explicit opt-in: E2E_RESET_ADMIN=1
//   3. The password comes from E2E_ADMIN_PASSWORD — there is NO default, so
//      no usable credential is committed to the repository.
//   4. The target database comes from DATABASE_URL and must be a local file
//      inside this repository checkout (dev sandbox), never a remote URL.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function bail(reason: string): never {
  console.error(`[e2e-admin-pw] REFUSING to run: ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  bail("NODE_ENV=production — this helper must never touch a production database.");
}
if (process.env.E2E_RESET_ADMIN !== "1") {
  bail("set E2E_RESET_ADMIN=1 to confirm you are resetting a DEV sandbox admin account.");
}
const password = process.env.E2E_ADMIN_PASSWORD;
if (!password || password.length < 8) {
  bail("set E2E_ADMIN_PASSWORD (min 8 chars) — no default password is committed.");
}

// The target DB must be a SQLite file inside this checkout.
const url = process.env.DATABASE_URL ?? `file:${REPO_ROOT}/db/custom.db`;
const filePath = url.replace(/^file:/, "").replace(/\?[^]*$/, "");
if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath)) {
  bail(`DATABASE_URL must point at a database inside this repository checkout (got: ${url}).`);
}

const { hashPassword } = await import("../../src/lib/password");
const db = new PrismaClient({ datasources: { db: { url } } });
const hash = await hashPassword(password);
await db.admin.update({
  where: { email: "admin@shopnest.com" },
  data: { passwordHash: hash, mustChangePassword: false, isActive: true, tokenVersion: { increment: 1 } },
});
console.log("[e2e-admin-pw] sandbox admin password set (value taken from E2E_ADMIN_PASSWORD, not committed).");
await db.$disconnect();
