import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";


// Next.js recommended rule sets are active (core-web-vitals + typescript).
// Only narrowly-scoped relaxations are kept, each with a reason.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Prisma-style code uses non-null assertions on verified lookups
      "@typescript-eslint/no-non-null-assertion": "off",
      // Generated shadcn/ui components contain `any` casts we don't own
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills",
      ".next/standalone/**",
      // Generated second Prisma client (rate-limit DB) — not our code
      "src/generated/**",
    ],
  },
];

export default eslintConfig;
