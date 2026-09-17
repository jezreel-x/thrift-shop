import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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

  execFileSync(process.execPath, [prismaCliPath(), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "inherit",
  });
}

/**
 * The path to Prisma's CLI entry point, run directly with the current Node
 * binary.
 *
 * The obvious `execFileSync("npx", ...)` needs `shell: true` on Windows, where
 * the launcher is a .cmd file — and Node deprecated that combination because
 * arguments reaching a shell are concatenated rather than escaped. Resolving the
 * package's own bin target sidesteps the shell completely, and works the same on
 * every platform.
 */
function prismaCliPath(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("prisma/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin: string | Record<string, string>;
  };

  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.prisma;

  return join(dirname(manifestPath), entry);
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
