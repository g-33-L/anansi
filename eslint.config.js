// Baseline lint gate (added 2026-07): configured pragmatically so the EXISTING
// codebase passes with zero errors. Several rules are intentionally disabled or
// downgraded to "warn" (e.g. no-explicit-any, no-console is not enabled, empty
// catches are allowed) because the current code uses those patterns on purpose.
// The intent is to ratchet rules up over time — tighten severities here rather
// than adding inline disables in app code.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.d.ts",
      "**/.venv/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/api/src/lib/db/migrations/**",
    ],
  },
  eslint.configs.recommended,
  // Non-type-checked recommended set: fast, no tsconfig project resolution,
  // and avoids the flood of type-aware errors on an un-linted codebase.
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser, // apps/graph-explorer is a Vite browser app
      },
    },
    // Registered (rules not enabled) so existing
    // `eslint-disable react-hooks/*` directives in apps/graph-explorer resolve
    // instead of erroring with "Definition for rule ... was not found".
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Intentional `as any` / `as never` casts exist throughout; allow them.
      "@typescript-eslint/no-explicit-any": "off",
      // Intentional empty catches (JSON.parse fallbacks etc.) are documented
      // with comments at the call sites.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Baseline: "warn" because a handful of pre-existing unused vars exist.
      // Ratchet to "error" once those are cleaned up.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Pre-existing single offenders (sanitize.ts regex, ingestion.ts
      // reassignment); warn for now, ratchet later.
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
    },
  }
);
