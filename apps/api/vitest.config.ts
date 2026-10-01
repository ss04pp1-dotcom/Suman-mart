import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

// Integration tests run against a REAL local D1 + R2 (workerd/miniflare) with
// the actual wrangler migrations applied — no mocks, no SQLite shims.
// Bindings (DB, MEDIA, vars) come from wrangler.jsonc — single source of truth.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    test: {
      include: ["tests/**/*.test.ts"],
      poolOptions: {
        workers: {
          // The worker under test — importable as SELF from "cloudflare:test".
          main: path.join(__dirname, "src", "index.ts"),
          wrangler: { configPath: path.join(__dirname, "wrangler.jsonc") },
          miniflare: {
            // Test-only bindings layered on top of wrangler.jsonc:
            // migrations (read on the node side — workerd has no filesystem)
            // and the test environment marker.
            bindings: {
              ALLOWED_ORIGINS: "*",
              ENVIRONMENT: "test",
              __D1_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
