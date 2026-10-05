import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { type VariantAvailability, freeUnits } from "./availability";

/**
 * Holding stock while its buyer pays.
 *
 * This is the one place in the shop where correctness is genuinely hard. When
 * the last unit of a size is left — and for a thrift item there is only ever
 * one — two people reaching checkout at the same moment must not both get it,
 * and the one who does not must be told before they send money.
 *
 * The naive version is a lost update:
 *
 *     const free = await countFree(id);       // both read 1
 *     if (free >= 1) await hold(id, me);      // both pass, both hold
 *
 * Reserving therefore locks the variant's row (SELECT … FOR UPDATE), and only
 * then counts what other buyers hold and creates or extends this buyer's hold,
 * all in one transaction. A second buyer for the same variant waits on the lock
 * and counts after the first has committed. Buyers of different variants never
 * wait on each other, and nothing is locked across application logic.
 *
 * Holds are counted, never subtracted from stock. What a buyer can take is
 * `stock − units in other buyers' unexpired holds`, worked out at the moment
 * they reserve, so a hold that lapses simply stops counting. Expiry is a matter
 * of time, not of a job running: the sweep below deletes old rows for tidiness
 * and makes nothing correct. `stock` itself moves only when a sale is confirmed
 * or the owner changes it, and every move is written to StockMovement.
 *
 * See docs/product-variants.md and docs/one-of-one-stock.md.
 */

/** How long a buyer keeps their units while entering details and paying. */
export const RESERVATION_MINUTES = 15;

/**
 * How long a hold lasts once its buyer says they have paid.
 *
 * Fifteen minutes is right for "I am going to M-Pesa". It is badly wrong for
 * "I have paid and a person is checking their messages", which may mean
 * overnight — and units released in that window get sold to somebody else
 * while the first buyer's money is already gone.
 */
export const PAYMENT_REVIEW_HOURS = 24;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export type ReservationRefusal =
  /** Nothing left in this variant, and nothing coming back. */
  | "sold"
  /** Units remain, but other buyers are checking out with all of them. */
  | "held"
  /** No such variant, or its product has been withdrawn. */
  | "gone";

export type ReservationResult =
  | {
      ok: true;
      /** What was held: the amount asked for, or fewer if that is all that was free. */
      quantity: number;
      reservedUntil: Date;
    }
  | { ok: false; reason: ReservationRefusal };

/**
 * Holds up to `quantity` units of a variant for `holder` for the next
 * {@link RESERVATION_MINUTES}.
 *
 * Holds fewer when fewer are free, and says how many — checkout tells the buyer
 * before they pay. A buyer reserving again replaces their own hold rather than
 * competing with it, so refreshing checkout never loses them their place.
 */
export async function reserveVariant(
  variantId: string,
  holder: string,
  quantity = 1,
  now: Date = new Date(),
): Promise<ReservationResult> {
  const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * MS_PER_MINUTE);

  return prisma.$transaction(async (tx) => {
    // The lock. Everything after this line sees what earlier reservers of this
    // variant committed, and nobody else can reserve it until we finish.
    const [variant] = await tx.$queryRaw<{ stock: number; deletedAt: Date | null }[]>`
      SELECT v."stock", p."deletedAt"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
       WHERE v."id" = ${variantId}
         FOR UPDATE OF v
    `;

    if (!variant || variant.deletedAt) return { ok: false, reason: "gone" };
    if (variant.stock <= 0) return { ok: false, reason: "sold" };

    const free = freeUnits({
      stock: variant.stock,
      heldByOthers: await heldByOthers(tx, variantId, holder, now),
    });
    if (free <= 0) return { ok: false, reason: "held" };

    const take = Math.min(Math.max(1, Math.trunc(quantity)), free);

    await tx.stockHold.upsert({
      where: { variantId_holder: { variantId, holder } },
      create: { variantId, holder, quantity: take, expiresAt: reservedUntil },
      update: { quantity: take, expiresAt: reservedUntil },
    });

    return { ok: true, quantity: take, reservedUntil };
  });
}

/**
 * Gives units back, when their holder abandons checkout deliberately.
 *
 * Scoped to the holder: releasing someone else's hold is exactly the attack
 * this mechanism exists to prevent.
 */
export async function releaseReservation(variantId: string, holder: string): Promise<boolean> {
  return prisma.$transaction((tx) => releaseHoldIn(tx, variantId, holder));
}

/**
 * Releases `holder`'s hold on a variant, inside the caller's transaction.
 *
 * Live or lapsed, the hold is released — but only if it is this holder's.
 * Rejecting an old order must never touch a hold somebody else has since
 * taken on the same variant.
 */
export async function releaseHoldIn(
  tx: Prisma.TransactionClient,
  variantId: string,
  holder: string,
): Promise<boolean> {
  const { count } = await tx.stockHold.deleteMany({ where: { variantId, holder } });

  return count > 0;
}

/**
 * Extends a hold while a claimed payment waits to be checked.
 *
 * Requires a live hold belonging to the buyer, so it cannot be used to seize
 * units they never reserved.
 */
export async function holdForPaymentReview(
  variantId: string,
  holder: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await prisma.stockHold.updateMany({
    where: { variantId, holder, expiresAt: { gt: now } },
    data: { expiresAt: new Date(now.getTime() + PAYMENT_REVIEW_HOURS * MS_PER_HOUR) },
  });

  return count === 1;
}

/**
 * Completes a sale once payment is confirmed: the held units leave stock.
 *
 * Requires a live hold of this buyer's covering the quantity. A lapsed hold
 * cannot be converted — those units may already be in someone else's
 * checkout, and honouring the stale hold is how two people pay for one item.
 */
export async function confirmSale(input: {
  variantId: string;
  holder: string;
  quantity: number;
  orderId?: string;
  now?: Date;
}): Promise<boolean> {
  return prisma.$transaction((tx) => confirmSaleIn(tx, input));
}

/**
 * {@link confirmSale} inside the caller's transaction, so confirming an order
 * with several lines sells all of them or none.
 */
export async function confirmSaleIn(
  tx: Prisma.TransactionClient,
  {
    variantId,
    holder,
    quantity,
    orderId,
    now = new Date(),
  }: { variantId: string; holder: string; quantity: number; orderId?: string; now?: Date },
): Promise<boolean> {
  const [variant] = await tx.$queryRaw<{ stock: number }[]>`
    SELECT "stock" FROM "ProductVariant" WHERE "id" = ${variantId} FOR UPDATE
  `;
  const hold = await tx.stockHold.findUnique({
    where: { variantId_holder: { variantId, holder } },
  });

  if (!variant || !hold) return false;
  if (hold.expiresAt <= now || hold.quantity < quantity) return false;
  // The owner may have lowered stock below what was held. Selling units that
  // are not there would be the double sale this module exists to prevent.
  if (variant.stock < quantity) return false;

  await tx.productVariant.update({
    where: { id: variantId },
    data: { stock: { decrement: quantity } },
  });
  await tx.stockHold.delete({ where: { id: hold.id } });
  await tx.stockMovement.create({
    data: { variantId, change: -quantity, reason: "sale confirmed", orderId: orderId ?? null },
  });

  return true;
}

/**
 * Deletes holds that have lapsed.
 *
 * Tidiness only. A lapsed hold already counts for nothing — see the module
 * comment — so the shop is correct whether or not this ever runs.
 */
export async function releaseExpiredReservations(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.stockHold.deleteMany({ where: { expiresAt: { lte: now } } });

  return count;
}

/**
 * Stock and other buyers' holds for some variants, as one shopper sees them.
 *
 * `viewer` is that shopper: their own hold does not count against them, which
 * is what lets someone return to their cart mid-checkout without being told
 * their own units are taken.
 */
export async function getAvailability(
  variantIds: string[],
  viewer?: string,
  now: Date = new Date(),
): Promise<Map<string, VariantAvailability>> {
  if (variantIds.length === 0) return new Map();

  const [variants, holds] = await Promise.all([
    prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, stock: true },
    }),
    prisma.stockHold.groupBy({
      by: ["variantId"],
      where: {
        variantId: { in: variantIds },
        expiresAt: { gt: now },
        ...(viewer ? { holder: { not: viewer } } : {}),
      },
      _sum: { quantity: true },
    }),
  ]);

  const held = new Map(holds.map((row) => [row.variantId, row._sum.quantity ?? 0]));

  return new Map(
    variants.map((variant) => [
      variant.id,
      { stock: variant.stock, heldByOthers: held.get(variant.id) ?? 0 },
    ]),
  );
}

async function heldByOthers(
  tx: Prisma.TransactionClient,
  variantId: string,
  holder: string,
  now: Date,
): Promise<number> {
  const { _sum } = await tx.stockHold.aggregate({
    where: { variantId, holder: { not: holder }, expiresAt: { gt: now } },
    _sum: { quantity: true },
  });

  return _sum.quantity ?? 0;
}
