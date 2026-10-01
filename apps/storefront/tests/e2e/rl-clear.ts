// E2E helper: clear rate-limit buckets between test phases.
//
// SAFEGUARDS (round-4 audit): wiping buckets disables brute-force protection,
// so this refuses to run in production and requires an explicit opt-in, and
// only ever touches a rate-limit DB inside this repository checkout.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

function bail(reason: string): never {
  console.error(`[e2e-rl-clear] REFUSING to run: ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") bail("NODE_ENV=production.");
if (process.env.E2E_RL_CLEAR !== "1") bail("set E2E_RL_CLEAR=1 to confirm.");

const url = process.env.RATELIMIT_DATABASE_URL ?? `file:${REPO_ROOT}/db/ratelimit.db`;
const filePath = url.replace(/^file:/, "").replace(/\?[^]*$/, "");
if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath)) {
  bail(`RATELIMIT_DATABASE_URL must point inside this repository checkout (got: ${url}).`);
}

const { PrismaClient: RlClient } = await import("../../src/generated/ratelimit");
const rl = new RlClient({ datasources: { ratelimit: { url } } });
await rl.rateLimitEntry.deleteMany({});
console.log("[e2e-rl-clear] rate-limit buckets cleared");
await rl.$disconnect();
