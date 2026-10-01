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
