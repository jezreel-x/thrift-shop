import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Which database the Prisma CLI talks to.
 *
 * The default is deliberately the *local* one. `prisma migrate dev` is a
 * development command — when it finds a database that does not match the
 * migration history it offers to reset it, meaning drop everything and replay
 * from scratch. That is entirely reasonable against a scratch database and
 * catastrophic against a live catalogue, so the command that can reset points
 * somewhere disposable, and reaching production takes a deliberate act.
 *
 * Set PRISMA_TARGET=production to act on Neon. `npm run db:deploy` does exactly
 * that, and runs `migrate deploy`, which applies pending migrations and can
 * never reset or prompt.
 */
const target = process.env.PRISMA_TARGET === "production" ? "production" : "development";

/**
 * An exact connection string, overriding the choice below.
 *
 * The integration suite uses this to migrate its own throwaway database. It
 * cannot rely on DATABASE_URL, because this file deliberately ignores that —
 * the whole point is that the CLI's target is chosen here rather than inherited
 * from whatever the application happens to be pointed at.
 */
const explicitUrl = process.env.PRISMA_DATABASE_URL;

const url =
  explicitUrl ??
  (target === "production"
    ? // Migrations need the unpooled connection: Prisma Migrate holds a
      // session-level advisory lock across statements, which PgBouncer's
      // transaction pooling does not support.
      (process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DEV_DATABASE_URL);

// Warned about rather than thrown on. `prisma generate` needs no database at
// all, and it runs in CI and on every install — refusing to load the config
// there would break builds that were never going to connect to anything.
// Commands that do need a database still fail, with Prisma's own message.
if (!url) {
  console.warn(
    "prisma: no database configured. " +
      (target === "production"
        ? "Set DIRECT_DATABASE_URL to act on production."
        : "Set DEV_DATABASE_URL, or start the local databases with `npm run db:test:up`."),
  );
} else {
  // Printed on every invocation, because the one thing you always want to know
  // before a migration runs is which database is about to change.
  console.info(`prisma: ${explicitUrl ? "explicit" : target} — ${describe(url)}`);
}

function describe(connectionString: string): string {
  try {
    const { host, pathname } = new URL(connectionString);

    return `${pathname.replace(/^\//, "")} at ${host}`;
  } catch {
    return "unparseable connection string";
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: { url },
});
