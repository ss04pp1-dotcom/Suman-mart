// E2E helper: inject a KNOWN guest-checkout OTP into the sandbox database
// (the real issuance path emails a random code, which the harness cannot
// read — delivery to a real provider is impossible in the sandbox).
//
// SAFEGUARDS: dev-sandbox only — refuses in production, requires opt-in,
// and only touches a database inside this repository checkout.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function bail(reason: string): never {
  console.error(`[e2e-inject-otp] REFUSING to run: ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") bail("NODE_ENV=production.");
if (process.env.E2E_INJECT_OTP !== "1") bail("set E2E_INJECT_OTP=1 to confirm.");

const email = process.argv[2];
const code = process.argv[3];
if (!email || !/^\d{6}$/.test(code ?? "")) {
  bail("usage: E2E_INJECT_OTP=1 bun tests/e2e/inject-otp.ts <email> <6-digit-code>");
}

const url = process.env.DATABASE_URL ?? `file:${REPO_ROOT}/db/custom.db`;
const filePath = url.replace(/^file:/, "").replace(/\?[^]*$/, "");
if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath)) {
  bail(`DATABASE_URL must point inside this repository checkout (got: ${url}).`);
}
// src/lib/guest-otp imports the shared Prisma client (@/lib/db) at module
// load — the datasource URL must be set BEFORE the import executes.
process.env.DATABASE_URL = url;

const { guestOtpHashFor } = await import("../../src/lib/guest-otp");
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url } } });
await db.guestEmailOtp.create({
  data: {
    email: email.toLowerCase(),
    codeHash: guestOtpHashFor(email, code),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  },
});
console.log(`[e2e-inject-otp] injected code ${code} for ${email}`);
await db.$disconnect();
