// GET /health — operational liveness/readiness probe.
// Verifies the D1 binding actually answers (SELECT 1) — a worker that boots
// but lost its database binding must report unhealthy.

import { Hono } from "hono";
import type { Env } from "../env";

export const health = new Hono<{ Bindings: Env }>();

health.get("/", async (c) => {
  const started = Date.now();
  let dbOk = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    checks: { database: dbOk ? "ok" : "fail" },
    environment: c.env.ENVIRONMENT ?? "development",
    time: new Date().toISOString(),
  };
  return c.json(body, dbOk ? 200 : 503, { "Cache-Control": "no-store" });
});
