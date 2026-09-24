import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Applies pending migrations during a Vercel build, and only during one.
 *
 * Until now, migrations reached production because somebody ran them by hand.
 * That works right up to the first time it is forgotten, and the symptom is a
 * deployment whose code expects a column the database does not have — errors on
 * live pages, at the worst possible moment, with no obvious cause.
 *
 * Deliberately skipped everywhere else. CI builds against a placeholder
 * connection string with no database behind it, and a local `npm run build`
 * should never quietly alter a shared database as a side effect of compiling.
 *
 * `migrate deploy` is the safe half of the CLI: it applies what is pending and
 * has no power to reset or prompt.
 */

if (!process.env.VERCEL) {
  console.info("migrate-on-deploy: not a Vercel build, skipping migrations.");
  process.exit(0);
}

console.info("migrate-on-deploy: applying pending migrations...");

execFileSync(process.execPath, [prismaCliPath(), "migrate", "deploy"], {
  env: { ...process.env, PRISMA_TARGET: "production" },
  stdio: "inherit",
});

/** Prisma's CLI entry point, run directly so no shell is involved. */
function prismaCliPath() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("prisma/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.prisma;

  return join(dirname(manifestPath), entry);
}
