import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const resolveAlias = { "@": path.resolve(__dirname, "src") };

// Integration tests run against a REAL local D1 + R2 (workerd/miniflare) with
// the actual wrangler migrations applied — no mocks, no SQLite shims.
// Bindings (DB, MEDIA, vars) come from wrangler.jsonc — single source of truth.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    resolve: { alias: resolveAlias },
    // The Vite SSR pipeline statically rewrites bare `process.env.X` accesses,
    // which would bypass workerd's real (bridged) environment. Substituting
    // `process.env` with the bridge-managed global object makes the ported
    // code (written as `process.env.X`, identical to the Node monolith) read
    // the values the env bridge copied from the bindings. The production
    // bundle is built by wrangler/esbuild, where this define does not exist
    // and process.env is workerd's own.
    define: { "process.env": "(globalThis as any).__snApiEnv" },
    test: {
      include: ["tests/**/*.test.ts"],
      // Prisma's workerd-runtime client + D1 adapter must be BUNDLED by Vite
      // (their .wasm?module imports don't survive externalization).
      server: {
        deps: {
          inline: [/@prisma\//, /generated\/prisma/],
        },
      },
      poolOptions: {
        workers: {
          // The worker under test — importable as SELF from "cloudflare:test".
          main: path.join(__dirname, "src", "index.ts"),
          wrangler: { configPath: path.join(__dirname, "wrangler.jsonc") },
          miniflare: {
            compatibilityFlags: ["nodejs_compat"],
            rules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }],
            // Test-only bindings layered on top of wrangler.jsonc:
            // migrations (read on the node side — workerd has no filesystem)
            // and the test environment marker.
            bindings: {
              ALLOWED_ORIGINS: "*",
              ENVIRONMENT: "test",
              SESSION_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
              ADMIN_SESSION_SECRET: "test-admin-secret-0123456789abcdef01234",
              TOTP_ENC_KEY: "test-totp-key-0123456789abcdef0123456789",
              __D1_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
