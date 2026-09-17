import { beforeEach } from "vitest";

import { prisma } from "@/lib/prisma";

/**
 * Helpers for tests that talk to a real database.
 *
 * The application's own Prisma singleton is used deliberately: the integration
 * config points DATABASE_URL at the test database, so the code under test runs
 * exactly as it does in production rather than through a client injected only
 * for tests.
 */

/**
 * Empties every table. Registered by {@link useCleanDatabase}.
 *
 * TRUNCATE ... CASCADE rather than deleting rows in dependency order: it is one
 * statement, it cannot be defeated by adding a table later, and it resets much
 * faster than a cascade of DELETEs.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "ProductStatusHistory", "ProductImage", "Product" RESTART IDENTITY CASCADE`,
  );
}

/**
 * Clears the database before each test in the calling file.
 *
 * Before, not after: a failed test leaves its rows behind for inspection, and
 * the next test still starts from a known state. Cleaning up afterwards would
 * destroy the evidence at exactly the moment it becomes useful.
 *
 * Not named `useCleanDatabase` — the `use` prefix is reserved for React hooks,
 * and the hooks lint rule rightly objects to anything else wearing it.
 */
export function cleanDatabaseBetweenTests(): void {
  beforeEach(resetDatabase);
}

export { prisma as db };
