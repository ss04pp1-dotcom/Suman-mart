// E2E helper: inject a KNOWN guest-checkout OTP into the sandbox database
// (the real issuance path emails a random code, which the harness cannot
// read — delivery to a real provider is impossible in the sandbox).
//
// SAFEGUARDS: dev-sandbox only — refuses in production, requires opt-in,
// and only ever touches the LOCAL D1 (`wrangler d1 execute --local`).
import { d1run, guestOtpHashFor, sqlDate } from "./d1";

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

const codeHash = await guestOtpHashFor(email, code);
// Same row shape the API's own supersede+insert batch writes (ISO-8601 TEXT
// dates, attempts 0). New rows for the same email win over older ones because
// verification picks the newest unexpired match.
d1run(
  `INSERT INTO "GuestEmailOtp" ("id", "email", "codeHash", "expiresAt", "attempts", "createdAt") ` +
    `VALUES ('${crypto.randomUUID()}', '${email.toLowerCase()}', '${codeHash}', ${sqlDate(Date.now() + 10 * 60_000)}, 0, ${sqlDate()})`
);
console.log(`[e2e-inject-otp] injected code ${code} for ${email}`);
