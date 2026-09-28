import { createHash, randomBytes } from "node:crypto";

import type { Role } from "@/generated/prisma/enums";
import { prisma } from "../prisma";

/**
 * Sessions, kept in the database.
 *
 * A signed token cannot be withdrawn once issued, which is why systems built on
 * them grow refresh tokens, rotation, reuse detection and revocation lists —
 * machinery whose entire purpose is to recover control the design gave away.
 * A row can be deleted. Signing somebody out, everywhere, is one statement.
 *
 * The price is a lookup per request, on pages that already query this database
 * to render themselves, against a primary key, in the same datacentre. It is not
 * a price worth avoiding.
 */

/** How long a session survives without being used. */
export const SESSION_DAYS = 7;

/** The cookie the browser carries. */
export const SESSION_COOKIE = "thrift_session";

const MS_PER_DAY = 86_400_000;

/**
 * How much of a session's life must elapse before using it extends it.
 *
 * Sliding expiry means an active shopper is never signed out. Extending on every
 * request would mean a database write per page view, so the renewal only happens
 * past the halfway mark — at most one write per user every three and a half days,
 * with identical behaviour.
 */
const RENEW_AFTER = 0.5;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  /** Canonical 254XXXXXXXXX, or null until checkout has asked for it. */
  phone: string | null;
  role: Role;
};

export type SessionRequestInfo = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

/**
 * Turns the cookie value into the database key.
 *
 * SHA-256, not argon2, and the difference is the point. Slow hashing exists to
 * make guessing a human-chosen password expensive. This token is 32 random bytes
 * — guessing it is already hopeless — so a slow hash here would tax every page
 * load and buy nothing.
 *
 * What it does buy: a stolen copy of the database contains no usable session
 * tokens, only their hashes.
 */
function tokenToId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a session and returns the token for the cookie.
 *
 * The raw token is returned once and never stored. If it is lost, the session is
 * unreachable — which is the correct behaviour, not a limitation.
 */
export async function createSession(
  userId: string,
  info: SessionRequestInfo = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * MS_PER_DAY);

  await prisma.session.create({
    data: {
      id: tokenToId(token),
      userId,
      expiresAt,
      userAgent: info.userAgent?.slice(0, 500) ?? null,
      ipAddress: info.ipAddress ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolves a token to its user, extending the session if it is due.
 *
 * An expired session is deleted on sight rather than merely ignored, so the
 * table does not accumulate rows nobody will ever look at again.
 */
export async function readSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const id = tokenToId(token);
  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, phone: true, role: true } },
    },
  });

  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id } }).catch(() => {
      // Already gone — a concurrent request or the sweep got there first.
    });

    return null;
  }

  const lifetime = SESSION_DAYS * MS_PER_DAY;
  const elapsed = lifetime - (session.expiresAt.getTime() - now);

  if (elapsed > lifetime * RENEW_AFTER) {
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(now + lifetime), lastUsedAt: new Date(now) },
    });
  }

  return session.user;
}

/** Signs out one browser. */
export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;

  await prisma.session.delete({ where: { id: tokenToId(token) } }).catch(() => {
    // Signing out of a session that is already gone is a success, not an error.
  });
}

/**
 * Signs out every browser for a user.
 *
 * What a password change should do, and what "log out everywhere" means. With
 * database sessions it is one statement — the operation that, with signed
 * tokens, needs a whole invalidation mechanism to approximate.
 */
export async function destroyAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });

  return count;
}

/**
 * Clears sessions nobody can use any more.
 *
 * Housekeeping, not security: an expired session is already refused by
 * {@link readSession}. This stops the table growing forever.
 */
export async function deleteExpiredSessions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });

  return count;
}
