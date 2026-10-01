import { defineConfig } from "vitest/config";
import path from "path";

// Phase-9 note: the storefront is a pure UI + proxy tier — its only remaining
// unit tests are pure-logic suites (lib/json escaping etc.). All business-
// logic tests live in apps/api (real local D1 + R2 via vitest-pool-workers).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      SESSION_SECRET: "vitest-session-secret-0123456789abcdef0123456789",
      NODE_ENV: "test",
    },
  },
});
