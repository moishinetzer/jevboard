import { defineConfig } from "vitest/config";

/**
 * End-to-end suites (`pnpm test:e2e`): the built Worker running locally, plus
 * live checks against the real OpenRouter and Autumn sandbox APIs that skip
 * themselves unless the matching keys are set.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
