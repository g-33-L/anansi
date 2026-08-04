import { defineConfig, coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    setupFiles: ["src/test/setup.ts"],
    // integration.test.ts and v1.test.ts both run `TRUNCATE workspaces CASCADE`
    // in beforeEach against the same local DB. Running test files in parallel
    // lets one suite's TRUNCATE wipe rows another suite is mid-test on. Serialize
    // file execution so each suite owns the database for its duration.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // Extends (not replaces) vitest defaults — a bare custom list drops the
      // default dist/** exclusion and counts stale build output locally.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/test/**",
        "src/lib/db/migrations/**",
        "scripts/**",
        "drizzle.config.ts",
        // Process entrypoints — bootstrap wiring, exercised by deploy health checks
        "src/index.ts",
        "src/worker-entry.ts",
        // Server-rendered UI routes — markup, not logic
        "src/routes/landing.tsx",
        // docs.tsx was split into per-section modules (commit c50bc20); exclude the
        // markup modules as before. index.ts/router.ts (routing logic) stay counted.
        "src/routes/docs/**/*.tsx",
        "src/routes/legal.tsx",
        "src/routes/portal.tsx",
        "src/routes/dashboard.tsx",
        "src/routes/onboarding.tsx",
        "src/routes/memory-view.tsx",
      ],
      // Regression floor, not a target — set just below measured coverage
      // (38.5% lines / 61% branches / 35.7% funcs as of 2026-07). Ratchet
      // upward as coverage grows; never lower to make a red build green.
      thresholds: {
        statements: 35,
        branches: 55,
        functions: 32,
        lines: 35,
      },
    },
  },
});
