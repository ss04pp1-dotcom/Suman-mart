// Prisma client bound to the request's D1 database (Cloudflare Workers).
//
// The business logic ported from the storefront imports `{ db } from "@/lib/db"`
// and uses it exactly as on Node — this module swaps the connection factory:
// PrismaClient + @prisma/adapter-d1 (query-compiler WASM, no native engine).
//
// Bindings arrive per request (`env.DB`), but are identical for every request
// an isolate serves, so ONE client per isolate is created lazily on first use
// after `bindDb(env)` records the binding (called by the env bridge middleware
// in src/index.ts on every request — see bridgeEnv).
//
// NOTE: interactive `db.$transaction(async (tx) => ...)` is NOT supported by
// the D1 adapter. All transactional paths ported from the monolith were
// rewritten with D1-native atomic batches (`env.DB.batch`) or guarded
// conditional updates — see src/lib/checkout.ts and src/lib/order-flow.ts.

import { PrismaClient } from "../generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { Env } from "../env";

type Client = InstanceType<typeof PrismaClient>;

interface DbGlobal {
  __apiEnv?: Env;
  __apiPrisma?: Client;
}

const g = globalThis as unknown as DbGlobal;

/** Record the D1 binding for this isolate (idempotent). */
export function bindDb(env: Env) {
  g.__apiEnv = env;
}

function client(): Client {
  if (!g.__apiPrisma) {
    if (!g.__apiEnv?.DB) {
      throw new Error("db accessed before bindDb(env) — the env bridge middleware must run first");
    }
    g.__apiPrisma = new PrismaClient({ adapter: new PrismaD1(g.__apiEnv.DB) }) as Client;
  }
  return g.__apiPrisma;
}

/**
 * The Prisma client. A Proxy defers client construction to first property
 * access so importing this module never requires an active request.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, prop: string) {
    const value = (client() as unknown as Record<string, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client()) : value;
  },
});
