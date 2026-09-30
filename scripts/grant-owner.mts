import "dotenv/config";

/**
 * Makes an existing account the shop's owner — the one way in when nobody is
 * staff yet.
 *
 *   npm run staff:grant-owner -- owner@example.com              (local)
 *   npm run staff:grant-owner:production -- owner@example.com   (Neon)
 *
 * Sign up on the site first; this promotes an account, it does not create one,
 * so no password ever passes through a terminal, a chat or an email.
 *
 * After this, everybody else is added from the Staff screen by someone holding
 * STAFF_MANAGE, and every grant there is recorded against the person who made
 * it. This script's grant is recorded too, with no actor.
 */

const production = process.env.PRISMA_TARGET === "production";

if (production) {
  const url = process.env.PRODUCTION_DATABASE_URL;
  if (!url) {
    console.error("PRODUCTION_DATABASE_URL is not set in .env.");
    process.exit(1);
  }
  // Read lazily by src/lib/env.ts, so setting it before the first query is enough.
  process.env.DATABASE_URL = url;
}

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run staff:grant-owner -- someone@example.com");
  process.exit(1);
}

const { grantOwnerRole } = await import("../src/lib/admin/staff");
const { prisma } = await import("../src/lib/prisma");

// Always say which database is about to change before changing it.
const { host, pathname } = new URL(process.env.DATABASE_URL ?? "");
console.info(`${production ? "PRODUCTION" : "local"} — ${pathname.slice(1)} at ${host}`);

try {
  const { granted } = await grantOwnerRole(email);
  console.info(granted ? `${email} is now an owner.` : `${email} was already an owner.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
