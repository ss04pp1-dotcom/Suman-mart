// Runs once when the Next.js server boots (dev + production start).
// Fails fast on invalid/weak environment configuration.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("@/lib/env");
  const { ok, errors, warnings } = checkEnv();
  for (const w of warnings) console.warn(`[env] WARNING: ${w}`);
  if (!ok) {
    for (const e of errors) console.error(`[env] FATAL: ${e}`);
    throw new Error(
      `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}\n` +
        "Fix the variables listed above (see .env.example) and restart the server."
    );
  }
}
