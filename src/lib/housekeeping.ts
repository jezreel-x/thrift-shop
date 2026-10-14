import { timingSafeEqual } from "node:crypto";

import { deleteExpiredSessions } from "./auth/session";
import { reconcilePrompts } from "./payments/stk";
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
 *
 * One exception, done first: asking Safaricom about M-Pesa prompts nobody
 * settled. The buyer's page settles nearly all of them while they wait; this is
 * the backstop for a buyer who closed it and a callback that never came, so a
 * paid prompt waits a day at most. Staff can ask sooner from the order page.
 */

/**
 * How long a lapsed hold stays visible before it is deleted. A WhatsApp hold
 * that ran out shows as "Ran out" on the stock page, so the owner can follow
 * up with the buyer; a day is long enough to notice.
 */
export const LAPSED_HOLD_GRACE_HOURS = 24;

export type HousekeepingReport = {
  /** M-Pesa prompts settled by asking Safaricom: paid or not. */
  prompts: number;
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

  // First, and the one part that is not tidying: a prompt nobody settled may
  // have been paid. Settled before anything is closed, so a paid order is
  // confirmed rather than cancelled.
  const prompts = await reconcilePrompts({ now });

  const [holds, sessions, carts, checkouts] = await Promise.all([
    releaseExpiredReservations(cutoff),
    deleteExpiredSessions(now),
    deleteAbandonedAnonymousCarts(now),
    cancelLapsedCheckouts(cutoff, now),
  ]);

  return { prompts, holds, sessions, carts, checkouts };
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
