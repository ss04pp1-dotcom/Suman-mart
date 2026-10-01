import { defineConfig } from "vitest/config";
import path from "path";

// Must match the schema built by tests/checkout.test.ts beforeAll().
const TEST_DB = path.resolve(__dirname, "db/test-checkout.db");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Several suites (checkout, guest-otp, order-flow DB tests, mailer) run
    // against ONE throwaway SQLite file — sequential file execution avoids
    // one file's schema reset racing another file's inserts.
    fileParallelism: false,
    // Integration tests (tests/checkout.test.ts) build a throwaway SQLite
    // schema; unit tests never touch the DB. Env must be set before module
    // imports (ES imports are hoisted past in-file statements).
    // High-concurrency checkout races serialize ~16 full transactions on the
    // in-process write mutex — on slower machines that legitimately takes
    // tens of seconds, so the default 5s per-test timeout is raised.
    testTimeout: 60_000,
    env: {
      DATABASE_URL: `file:${TEST_DB}`,
      // Rate-limit buckets go to a throwaway file too (separate SQLite DB —
      // see prisma/ratelimit/schema.prisma).
      RATELIMIT_DATABASE_URL: `file:${path.resolve(__dirname, "db/test-ratelimit.db")}`,
      SESSION_SECRET: "vitest-session-secret-0123456789abcdef0123456789",
      ADMIN_SESSION_SECRET: "vitest-admin-secret-0123456789abcdef0123456789",
      NODE_ENV: "test",
    },
  },
});
