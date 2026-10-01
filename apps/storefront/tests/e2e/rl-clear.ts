// E2E helper: clear rate-limit buckets between test phases.
//
// SAFEGUARDS (round-4 audit): wiping buckets disables brute-force protection,
// so this refuses to run in production, requires an explicit opt-in, and only
// ever touches the LOCAL D1 (`wrangler d1 execute --local`) — the remote
// production database is never reachable from this helper.
import { d1run } from "./d1";

function bail(reason: string): never {
  console.error(`[e2e-rl-clear] REFUSING to run: ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") bail("NODE_ENV=production.");
if (process.env.E2E_RL_CLEAR !== "1") bail("set E2E_RL_CLEAR=1 to confirm.");

d1run(`DELETE FROM "RateLimitEntry"`);
console.log("[e2e-rl-clear] rate-limit buckets cleared");
