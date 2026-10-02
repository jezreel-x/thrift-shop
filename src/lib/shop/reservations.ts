import type { Prisma } from "@/generated/prisma/client";
import { ProductStatus } from "@/generated/prisma/enums";
import { prisma } from "../prisma";

/**
 * Holding an item while its buyer pays.
 *
 * This is the one place in the shop where correctness is genuinely hard. Thrift
 * stock is one of one, so two people reaching checkout at the same moment is not
 * an inventory question — exactly one of them must win, and the other must be
 * told immediately rather than after they have sent money.
 *
 * The naive version is a lost update:
 *
 *     const item = await find(id);           // both read AVAILABLE
 *     if (item.status === "AVAILABLE") {     // both pass
 *       await update(id, "RESERVED");        // both write; both think they won
 *     }
 *
 * Every function here instead states its precondition inside the WHERE clause of
 * a single UPDATE, and reads the affected-row count to find out whether it won.
 * Postgres re-evaluates that clause after taking the row lock, so the second
 * writer sees the first writer's committed row and matches nothing. No lock is
 * held across application logic, and there is no window between the check and
 * the write, because they are the same statement.
 */

/** How long a buyer keeps an item while entering details and paying. */
export const RESERVATION_MINUTES = 15;

/**
 * How long an item stays held once its buyer says they have paid.
 *
 * The hold covers two quite different waits. Fifteen minutes is right for "I am
 * typing my details and going to M-Pesa". It is badly wrong for "I have paid and
 * a person is checking their SMS", which in v1 may mean overnight — and an item
 * released in that window gets sold to somebody else while the first buyer's
 * money is already gone.
 *
 * Deliberately the same mechanism with a longer window rather than a second
 * status, so the sweep, the catalogue query and checkout all keep working
 * unchanged.
 */
export const PAYMENT_REVIEW_HOURS = 24;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export type ReservationRefusal =
  /** Sold, and never coming back. */
  | "sold"
  /** Someone else is checking out with it right now. */
  | "held"
  /** No such item, or it has been withdrawn. */
  | "gone";

export type ReservationResult =
  { ok: true; reservedUntil: Date } | { ok: false; reason: ReservationRefusal };

/**
 * Claims an item for `holder` for the next {@link RESERVATION_MINUTES}.
 *
 * An expired hold is treated as available immediately, without waiting for the
 * sweep: the sweep exists to keep the catalogue honest, not to make this
 * correct. And a holder who already has the item simply extends their own hold,
 * so refreshing the checkout page does not lose it to the person behind them.
 */
export async function reserveProduct(
  productId: string,
  holder: string,
  now: Date = new Date(),
): Promise<ReservationResult> {
  const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * MS_PER_MINUTE);

  return prisma.$transaction(async (tx) => {
    // Read only to describe what happened, never to decide it. If this value is
    // stale by the time the UPDATE runs, the UPDATE still refuses correctly —
    // the worst case is a status-history row that names the wrong previous
    // state, which is a logging inaccuracy rather than a double sale.
    const before = await tx.product.findUnique({
      where: { id: productId },
      select: { status: true, deletedAt: true },
    });

    const claimed = await tx.product.updateMany({
      where: {
        id: productId,
        deletedAt: null,
        OR: [
          { status: ProductStatus.AVAILABLE },
          // A lapsed hold belongs to nobody, swept or not.
          { status: ProductStatus.RESERVED, reservedUntil: { lt: now } },
          // The same buyer, still checking out.
          { status: ProductStatus.RESERVED, reservedBy: holder },
        ],
      },
      data: { status: ProductStatus.RESERVED, reservedUntil, reservedBy: holder },
    });

    if (claimed.count === 0) {
      return { ok: false, reason: refusalFor(before) };
    }

    // Extending an existing hold is not a transition, and logging every page
    // refresh would bury the transitions that matter.
    if (before?.status !== ProductStatus.RESERVED) {
      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: before?.status ?? null,
          toStatus: ProductStatus.RESERVED,
          reason: "reserved at checkout",
        },
      });
    }

    return { ok: true, reservedUntil };
  });
}

/**
 * Gives an item back, when its holder abandons checkout deliberately.
 *
 * Scoped to the holder: releasing someone else's reservation is exactly the
 * attack this whole mechanism exists to prevent. Returns false when the caller
 * did not hold it, which is also what an already-expired hold looks like.
 */
export async function releaseReservation(productId: string, holder: string): Promise<boolean> {
  return prisma.$transaction((tx) => releaseHoldIn(tx, productId, holder, "checkout abandoned"));
}

/**
 * Releases `holder`'s hold on an item, inside the caller's transaction.
 *
 * Whether the hold is still live or has lapsed without being swept yet, it is
 * released — but only if it is still this holder's. That condition is the whole
 * point. Rejecting an old order must never touch an item somebody else has
 * since reserved: after a lapse and a sweep, the same jacket can be another
 * buyer's, and releasing "whatever hold is on it" would hand their item back to
 * the rail while they are paying for it.
 */
export async function releaseHoldIn(
  tx: Prisma.TransactionClient,
  productId: string,
  holder: string,
  reason: string,
): Promise<boolean> {
  const released = await tx.product.updateMany({
    where: { id: productId, status: ProductStatus.RESERVED, reservedBy: holder },
    data: { status: ProductStatus.AVAILABLE, reservedUntil: null, reservedBy: null },
  });

  if (released.count === 0) return false;

  await tx.productStatusHistory.create({
    data: {
      productId,
      fromStatus: ProductStatus.RESERVED,
      toStatus: ProductStatus.AVAILABLE,
      reason,
    },
  });

  return true;
}

/**
 * Extends a hold while a claimed payment waits to be checked.
 *
 * Called when the buyer submits their M-Pesa code — the moment their stake stops
 * being a few minutes of attention and becomes actual money. Requires a live
 * hold belonging to them, so it cannot be used to seize an item they never
 * reserved.
 *
 * No status change, so nothing is written to the history: the item is still
 * reserved to the same person, for longer.
 */
export async function holdForPaymentReview(
  productId: string,
  holder: string,
  now: Date = new Date(),
): Promise<boolean> {
  const reservedUntil = new Date(now.getTime() + PAYMENT_REVIEW_HOURS * MS_PER_HOUR);

  const extended = await prisma.product.updateMany({
    where: {
      id: productId,
      status: ProductStatus.RESERVED,
      reservedBy: holder,
      reservedUntil: { gt: now },
    },
    data: { reservedUntil },
  });

  return extended.count === 1;
}

/**
 * Completes the sale, once payment has been confirmed.
 *
 * Requires a live hold belonging to this holder. An expired reservation cannot
 * be converted: if the fifteen minutes elapsed, the item may already belong to
 * someone else, and honouring the stale hold is how two people end up paying for
 * one jacket.
 */
export async function confirmSale(
  productId: string,
  holder: string,
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction((tx) => confirmSaleIn(tx, productId, holder, now));
}

/**
 * {@link confirmSale} inside the caller's transaction, so that confirming an
 * order with several items can sell all of them or none.
 */
export async function confirmSaleIn(
  tx: Prisma.TransactionClient,
  productId: string,
  holder: string,
  now: Date = new Date(),
): Promise<boolean> {
  const sold = await tx.product.updateMany({
    where: {
      id: productId,
      status: ProductStatus.RESERVED,
      reservedBy: holder,
      reservedUntil: { gt: now },
    },
    data: { status: ProductStatus.SOLD, reservedUntil: null, reservedBy: null },
  });

  if (sold.count === 0) return false;

  await tx.productStatusHistory.create({
    data: {
      productId,
      fromStatus: ProductStatus.RESERVED,
      toStatus: ProductStatus.SOLD,
      reason: "payment confirmed",
    },
  });

  return true;
}

/**
 * Returns lapsed reservations to the catalogue.
 *
 * Without this, one abandoned checkout removes an item from the shop
 * permanently — the single worst failure mode available here, because it is
 * silent and the owner would only notice by missing the sale.
 *
 * Written as raw SQL for its RETURNING clause: `updateMany` reports how many
 * rows changed but not which, and the status history needs the ids of exactly
 * the rows this call released, not the ones that merely looked expired a moment
 * earlier.
 */
export async function releaseExpiredReservations(now: Date = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const released = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Product"
         SET status = 'AVAILABLE'::"ProductStatus",
             "reservedUntil" = NULL,
             "reservedBy" = NULL
       WHERE status = 'RESERVED'::"ProductStatus"
         AND "reservedUntil" < ${now}
      RETURNING id
    `;

    if (released.length === 0) return 0;

    await tx.productStatusHistory.createMany({
      data: released.map((row) => ({
        productId: row.id,
        fromStatus: ProductStatus.RESERVED,
        toStatus: ProductStatus.AVAILABLE,
        reason: "reservation expired",
      })),
    });

    return released.length;
  });
}

function refusalFor(
  before: { status: ProductStatus; deletedAt: Date | null } | null,
): ReservationRefusal {
  if (!before || before.deletedAt) return "gone";
  if (before.status === ProductStatus.SOLD) return "sold";

  return "held";
}
