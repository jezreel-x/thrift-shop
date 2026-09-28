import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * A single Prisma client per process, created on first use.
 *
 * Next.js hot-reloads modules in development, so a plain module-level client
 * would leak a new connection pool on every edit until Postgres refuses more.
 * Stashing it on `globalThis` survives the reload; production creates it once.
 *
 * Lazy, rather than built when this module is imported, and that matters more
 * than it looks. Importing a module should not need a database. Building it
 * eagerly meant that anything transitively reaching this file demanded
 * DATABASE_URL just to be loaded — which is why `next build` needed a
 * placeholder connection string, and why a unit test for a pure URL function
 * failed for want of one. A connection is opened when somebody queries, not
 * when somebody imports.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    client =
      globalForPrisma.prisma ??
      new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    }
  }

  return client;
}

/**
 * Behaves exactly like a PrismaClient; builds one the first time it is touched.
 *
 * Methods are bound to the real client, because a Prisma method pulled off the
 * proxy and called on its own — `const { $transaction } = prisma` — would
 * otherwise lose its `this`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property) as unknown;

    return typeof value === "function" ? value.bind(instance) : value;
  },
});
