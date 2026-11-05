import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,services,packages,tests}/**/*.test.ts"],
    // Suites that need PostgreSQL run with `npm run test:db` (vitest.db.config.ts).
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
