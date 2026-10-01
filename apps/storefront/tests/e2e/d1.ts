// E2E helper: query the Workers API's LOCAL D1 (the same database the
// `wrangler dev` server from boot.sh is serving — both share
// apps/api/.wrangler/state). This is the flipped-stack replacement for the
// old direct-SQLite Prisma access: the sandbox has no SQLite file anymore.
//
// Each call shells out to `wrangler d1 execute --local --json` (~1-2s) —
// fine for E2E assertions, never used inside unit tests.
//
// ⚠ Arguments are passed as an ARRAY (spawnSync, no shell): SQL payloads
// contain `$` (PBKDF2 hashes: pbkdf2$600000$salt$hash) which a shell would
// expand inside double quotes — this exact bug once silently corrupted the
// admin password hash mid-run.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const API_DIR = resolve(import.meta.dir, "../../../api"); // apps/api

export interface D1Row {
  [column: string]: unknown;
}

/** Run a single SQL statement against the local D1 and return its rows. */
export function d1(sql: string): D1Row[] {
  const run = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", "suman-mart", "--local", "--json", "--command", sql],
    { cwd: API_DIR, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, shell: false }
  );
  if (run.status !== 0 || run.error) {
    throw new Error(`d1 query failed (${run.status}): ${sql}\n${run.stderr?.toString().slice(0, 400)}`);
  }
  const parsed = JSON.parse(run.stdout.toString()) as Array<{ results?: D1Row[]; success: boolean }>;
  if (!parsed[0]?.success) throw new Error(`d1 query failed: ${sql}`);
  return parsed[0].results ?? [];
}

/** Run a mutation and ignore its result rows. */
export function d1run(sql: string): void {
  d1(sql);
}

/** Date literal in the Prisma-D1-adapter representation (ISO-8601 TEXT). */
export function sqlDate(ms = Date.now()): string {
  return `'${new Date(ms).toISOString().replace("Z", "+00:00")}'`;
}

/** sha256("<email>::<code>") hex — the GuestEmailOtp codeHash format (apps/api/src/lib/guest-otp.ts). */
export async function guestOtpHashFor(email: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email.toLowerCase()}::${code}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** PBKDF2-SHA256 600k — byte-identical to apps/api/src/lib/password.ts. */
export async function hashPassword(password: string): Promise<string> {
  const ITERATIONS = 600_000;
  const salt = new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as Uint8Array).toString("base64");
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
