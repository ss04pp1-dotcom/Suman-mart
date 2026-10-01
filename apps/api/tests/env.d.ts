// Ambient types for the test environment: expose the worker's bindings
// through `env` from "cloudflare:test".

import type { Env } from "../src/env";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    /** Wrangler migrations injected by vitest.config.ts (node side). */
    __D1_MIGRATIONS: D1Migration[];
  }
}
