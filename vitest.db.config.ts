import { defineConfig } from "vitest/config";

// Suites that need a PostgreSQL 17 + PostGIS + pgvector server at DATABASE_URL
// (a superuser connection to a maintenance database). Each suite creates and
// drops its own database; suites run one after another because they share
// cluster-wide roles.
export default defineConfig({
  test: {
    include: ["{apps,services,packages,tests}/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});
