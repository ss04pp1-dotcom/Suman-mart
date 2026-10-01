// E2E helper: compute the CURRENT TOTP code for a known secret.
// Read-only utility — safe by construction (no database access).
import { generateTotp } from "../../src/lib/totp";
const secret = process.argv[2];
if (!secret) {
  console.error("usage: bun tests/e2e/totp-code.ts <base32-secret>");
  process.exit(1);
}
console.log(await generateTotp(secret, Date.now()));
