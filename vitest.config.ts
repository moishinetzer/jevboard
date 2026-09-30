import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.test.ts", "test/**/*.test.ts"],
    // End-to-end suites run separately with `pnpm test:e2e` (vitest.e2e.config.ts).
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    environment: "node",
  },
});
