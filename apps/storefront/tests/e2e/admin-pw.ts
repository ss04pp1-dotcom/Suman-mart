// E2E helper: set a known password for the sandbox admin account (local D1).
//
// SAFEGUARDS (round-4 audit — this script once carried a committed default
// password and a hardcoded sandbox path; if run by mistake against a
// production database it would stamp a PUBLICLY KNOWN password onto the
// admin account):
//   1. Refuses to run when NODE_ENV=production.
//   2. Requires an explicit opt-in: E2E_RESET_ADMIN=1
//   3. The password comes from E2E_ADMIN_PASSWORD — there is NO default, so
//      no usable credential is committed to the repository.
//   4. It targets the LOCAL D1 only (`wrangler d1 execute --local`) — the
//      remote production database is never reachable from this helper.
import { d1run, hashPassword } from "./d1";

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

const hash = await hashPassword(password);
d1run(
  `UPDATE "Admin" SET "passwordHash" = '${hash}', "mustChangePassword" = 0, "isActive" = 1, ` +
    `"tokenVersion" = "tokenVersion" + 1 WHERE "email" = 'admin@shopnest.com'`
);
console.log("[e2e-admin-pw] sandbox admin password set (value taken from E2E_ADMIN_PASSWORD, not committed).");
