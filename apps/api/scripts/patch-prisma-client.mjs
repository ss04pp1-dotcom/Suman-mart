// Post-generate patch for the Prisma workerd-runtime client.
//
// Why: the generated class.ts imports the query-compiler WASM with workerd's
// `?module` convention:
//     await import("./query_compiler_bg.wasm?module")
// Wrangler/esbuild resolves that fine, but @cloudflare/vitest-pool-workers
// reads the module from disk with the query string still appended
// (`fs.readFileSync("...wasm?module")` → ENOENT → "No such module").
//
// The fix: drop the `?module` suffix and declare an explicit module rule
// `{ type: "CompiledWasm", include: ["**/*.wasm"] }` in BOTH wrangler.jsonc
// (esbuild path) and vitest.config.ts miniflare options (test path). With an
// explicit rule, plain `import("./x.wasm")` resolves as a CompiledWasm module
// in both runtimes.
//
// Run after every `prisma generate` (wired into package.json scripts).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, "src", "generated", "prisma", "internal", "class.ts");

let source = readFileSync(target, "utf8");
const BROKEN = 'await import("./query_compiler_bg.wasm?module")';
const FIXED = 'await import("./query_compiler_bg.wasm")';

if (!source.includes(BROKEN)) {
  if (source.includes(FIXED)) {
    console.log("prisma client already patched (wasm import without ?module) — nothing to do");
    process.exit(0);
  }
  console.error(`patch-prisma-client: expected pattern not found in ${target}.`);
  console.error("The generated client layout may have changed — inspect internal/class.ts and update this script.");
  process.exit(1);
}

source = source.replace(BROKEN, FIXED);
writeFileSync(target, source);
console.log(`patched ${path.relative(root, target)}: wasm import no longer uses ?module`);
