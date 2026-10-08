import { timingSafeEqual } from "node:crypto";

import { deleteExpiredSessions } from "./auth/session";
import { deleteAbandonedAnonymousCarts } from "./shop/cart";
import { releaseExpiredReservations } from "./shop/reservations";

/**
 * The daily tidy-up: rows that already count for nothing, deleted so the
 * tables don't grow forever.
 *
 * Nothing here makes the shop correct. An expired hold is already ignored when
 * stock is counted, an expired session is already refused, and an old cart
 * is simply never opened again. That is deliberate: if this never ran, the
 * shop would behave exactly the same, only with bigger tables.
 */

/**
 * How long a lapsed hold stays visible before it is deleted. A WhatsApp hold
 * that ran out shows as "Ran out" on the stock page, so the owner can follow
 * up with the buyer; a day is long enough to notice.
 */
export const LAPSED_HOLD_GRACE_HOURS = 24;

export type HousekeepingReport = { holds: number; sessions: number; carts: number };

export async function runHousekeeping(now: Date = new Date()): Promise<HousekeepingReport> {
  const holdCutoff = new Date(now.getTime() - LAPSED_HOLD_GRACE_HOURS * 3_600_000);

  const [holds, sessions, carts] = await Promise.all([
    releaseExpiredReservations(holdCutoff),
    deleteExpiredSessions(now),
    deleteAbandonedAnonymousCarts(now),
  ]);

  return { holds, sessions, carts };
}

/**
 * Whether a request carries the cron secret, as Vercel sends it:
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Refuses everything when no secret is configured, rather than running for
 * anyone. Compared in constant time, so the response time says nothing about
 * how much of a guess was right.
 */
export function isCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);

  return given.length === expected.length && timingSafeEqual(given, expected);
}
