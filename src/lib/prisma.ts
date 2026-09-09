import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * A single Prisma client per process.
 *
 * Next.js hot-reloads modules in development, so a plain module-level client
 * would leak a new connection pool on every edit until Postgres refuses more.
 * Stashing it on `globalThis` survives the reload; production creates it once.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.databaseUrl }),
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
