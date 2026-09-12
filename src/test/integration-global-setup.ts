import { execFileSync } from "node:child_process";

/**
 * Prepares the integration-test database once, before any test file runs.
 *
 * Applies migrations with `prisma migrate deploy` rather than `db push`, so the
 * tests exercise the same migration files that will be applied to production. A
 * migration that works only when Prisma infers it from the schema is a migration
 * that fails on deploy.
 */
export default function setup() {
  const url = requireTestDatabaseUrl();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/**
 * Returns TEST_DATABASE_URL, refusing anything that does not look like a
 * throwaway database.
 *
 * The integration suite truncates every table between tests. Pointed at the
 * wrong connection string it would empty production, so the name is checked
 * rather than trusted: a database this suite is allowed to destroy must say so
 * in its name.
 */
function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test database with `docker compose up -d` " +
        "and copy the value from .env.example into .env.",
    );
  }

  const databaseName = new URL(url).pathname.replace(/^\//, "");

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${databaseName}". This suite truncates ` +
        `every table between tests, so it only accepts a database whose name ends in "_test".`,
    );
  }

  return url;
}
