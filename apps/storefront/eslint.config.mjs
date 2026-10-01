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
      // eslint-config-next (re-resolved by the monorepo workspace install) ships
      // the NEW react-hooks/set-state-in-effect rule as an error. The flagged
      // call sites are the canonical shadcn/ui patterns (embla carousel,
      // use-mobile) plus deliberate sync-from-URL effects — kept as warnings
      // until they are refactored, not silent errors.
      "react-hooks/set-state-in-effect": "warn",
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
