import "dotenv/config";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: real Postgres, no browser.
 *
 * Kept in a separate config from the unit suite because the two have opposite
 * needs. Unit tests are fast, isolated and run on every save; these need a
 * database, run serially, and are slow enough that mixing them would make the
 * quick feedback loop not quick.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./src/test/integration-global-setup.ts"],
    globals: true,

    // One file at a time. Every test truncates the database, so running two in
    // parallel would have them deleting each other's fixtures.
    fileParallelism: false,

    // The application code reads DATABASE_URL. Pointing it at the test database
    // here means the functions under test need no special wiring — they open the
    // same connection they would in production, to a different database.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
