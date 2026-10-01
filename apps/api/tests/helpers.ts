// Shared test bootstrap: applies the REAL wrangler D1 migrations + the seed
// fixture to the local D1, and stages one object in R2.
//
// With isolatedStorage (default) storage is reset between test FILES; call
// `await initDb()` from every file's beforeAll so each file starts from the
// exact same state. The globalThis guard makes repeat calls no-ops.

import { env } from "cloudflare:test";
import { SEED_SQL } from "./seed";

const g = globalThis as unknown as { __apiTestsReady?: Promise<void> };

/** Splits a SQL script into statements on `;` line endings, stripping comment lines. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

// ── PBKDF2-SHA256, 600k iterations — byte-identical to src/lib/password.ts
// (computed here so seed rows verify through the REAL login endpoints).
const PBKDF2_ITERATIONS = 600_000;

async function pbkdf2Hash(password: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  let binary = "";
  for (const b of new Uint8Array(bits)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  let saltBinary = "";
  for (const b of salt) saltBinary += String.fromCharCode(b);
  const saltB64 = btoa(saltBinary);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${await pbkdf2Hash(password, saltB64)}`;
}

/** Write-path fixtures (admin account + coupon) with properly-hashed passwords. */
async function seedWritePathFixtures(): Promise<void> {
  const adminHash = await hashPassword("Admin123!SuperSecure");
  await env.DB.prepare(
    `INSERT INTO Admin ("id","name","email","passwordHash","role","isActive","mustChangePassword","totpEnabled","createdAt","updatedAt")
     VALUES ('admin-root','Root Admin','admin@test.local',?1,'SUPER_ADMIN',1,0,0,?2,?2)`
  )
    .bind(adminHash, new Date().toISOString().replace("Z", "+00:00"))
    .run();

  const supportHash = await hashPassword("Support123!Pass");
  await env.DB.prepare(
    `INSERT INTO Admin ("id","name","email","passwordHash","role","isActive","mustChangePassword","totpEnabled","createdAt","updatedAt")
     VALUES ('admin-support','Support Agent','support@test.local',?1,'SUPPORT',1,0,0,?2,?2)`
  )
    .bind(supportHash, new Date().toISOString().replace("Z", "+00:00"))
    .run();

  // Coupon: 10% off (max 300), 100 total uses, 1 per customer identity.
  const nowIso = new Date().toISOString().replace("Z", "+00:00");
  await env.DB.prepare(
    `INSERT INTO Coupon ("id","code","type","value","maxDiscount","startsAt","expiresAt","usageLimit","usageCount","perCustomerLimit","isActive","createdAt")
     VALUES ('coupon-welcome','WELCOME10','PERCENTAGE',10,300,?1,NULL,100,0,1,1,?1)`
  )
    .bind(nowIso)
    .run();
}

export function initDb(): Promise<void> {
  if (!g.__apiTestsReady) {
    g.__apiTestsReady = (async () => {
      // Migrations were read from apps/api/migrations by vitest.config.ts
      // (node side) and injected as a binding — workerd has no filesystem.
      // D1's exec() rejects multi-line statements ("incomplete input"), so
      // each statement goes through prepare().run() instead.
      const statements: string[] = [];
      for (const migration of env.__D1_MIGRATIONS) {
        statements.push(...splitStatements(migration.queries.join("\n;\n")));
      }
      statements.push(...splitStatements(SEED_SQL));
      for (const statement of statements) {
        await env.DB.prepare(statement).run();
      }

      await seedWritePathFixtures();

      await env.MEDIA.put("products/earbuds-1.jpg", new Uint8Array([1, 2, 3, 4]), {
        httpMetadata: { contentType: "image/jpeg" },
      });
    })().catch((err) => {
      g.__apiTestsReady = undefined; // allow retry on failure
      throw err;
    });
  }
  return g.__apiTestsReady;
}

// ── Cookie jar helper (sessions ride Set-Cookie through the proxies) ──

export class CookieJar {
  private jar = new Map<string, string>();

  capture(res: Response) {
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  clear() {
    this.jar.clear();
  }
}

/** Minimal 1×1 PNG (magic bytes + IHDR + IEND) for upload tests. */
export const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
]);
