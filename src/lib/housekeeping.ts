import { timingSafeEqual } from "node:crypto";

import { deleteExpiredSessions } from "./auth/session";
import { deleteAbandonedAnonymousCarts } from "./shop/cart";
import { cancelLapsedCheckouts } from "./shop/orders";
import { releaseExpiredReservations } from "./shop/reservations";

/**
 * The daily tidy-up: rows that already count for nothing, deleted so the
 * tables don't grow forever, and unpaid orders that can no longer be paid,
 * closed so the queue stays honest.
 *
 * Nothing here makes the shop correct. An expired hold is already ignored when
 * stock is counted, an expired session is already refused, an old cart is
 * simply never opened again, and an order whose hold ran out already refuses a
 * code and says so. That is deliberate: if this never ran, the shop would
 * behave exactly the same, only with bigger tables and a longer "Awaiting
 * payment" tab.
 */

/**
 * How long a lapsed hold stays visible before it is deleted. A WhatsApp hold
 * that ran out shows as "Ran out" on the stock page, so the owner can follow
 * up with the buyer; a day is long enough to notice.
 */
export const LAPSED_HOLD_GRACE_HOURS = 24;

export type HousekeepingReport = {
  holds: number;
  sessions: number;
  carts: number;
  /** Unpaid orders closed because their hold ran out. */
  checkouts: number;
};

export async function runHousekeeping(now: Date = new Date()): Promise<HousekeepingReport> {
  // The same day's grace for both: a buyer's "Hold ran out" order stays open,
  // saying so, about as long as its lapsed holds stay visible.
  const cutoff = new Date(now.getTime() - LAPSED_HOLD_GRACE_HOURS * 3_600_000);

  const [holds, sessions, carts, checkouts] = await Promise.all([
    releaseExpiredReservations(cutoff),
    deleteExpiredSessions(now),
    deleteAbandonedAnonymousCarts(now),
    cancelLapsedCheckouts(cutoff, now),
  ]);

  return { holds, sessions, carts, checkouts };
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
