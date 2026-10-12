import type { Prisma } from "@/generated/prisma/client";

/**
 * Settling a paid order: the one rule every way of being paid ends in.
 *
 * Money can arrive late on every path (a slow PIN, a late reply from
 * Safaricom, a card payment finished after the buyer wandered off, a claim
 * nobody checked for a day), so none of them decides what "late" means on its
 * own. Once a payment is known to be good, its order is settled here:
 *
 *   the buyer's holds are still live    → sell the items
 *   the holds lapsed, the units are free → sell them anyway, the same way
 *   any unit is gone                     → sell nothing: the order needs a refund
 *
 * "Free" is worked out exactly as reserving does: stock less everyone else's
 * unexpired holds, under the variant's row lock, which every stock change in
 * the shop takes. So selling a lapsed order can never take a unit somebody
 * else is paying for. See docs/payments.md and docs/one-of-one-stock.md.
 *
 * All or nothing: if any item has gone, nothing is sold, and the whole payment
 * is refunded. A partial sale with a partial refund is simpler to get wrong
 * than to explain, and can come later if shops want it.
 */

export type SettleItem = { variantId: string; title: string; quantity: number };

export type SettleOutcome = { sold: true } | { sold: false; missing: string[] };

/**
 * Sells an order's items, inside the caller's transaction, or reports which
 * have gone. Writes nothing when anything is missing.
 */
export async function settleItemsIn(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    /** The buyer: their own holds don't count against them. */
    holder: string;
    items: SettleItem[];
    now?: Date;
  },
): Promise<SettleOutcome> {
  const now = input.now ?? new Date();
  const variantIds = [...new Set(input.items.map((item) => item.variantId))];

  // Locked in one fixed order, so two orders settling at once can't each hold
  // one lock the other is waiting for.
  const locked = await tx.$queryRaw<{ id: string; stock: number }[]>`
    SELECT "id", "stock" FROM "ProductVariant"
     WHERE "id" = ANY(${variantIds}) ORDER BY "id" FOR UPDATE
  `;
  const stock = new Map(locked.map((row) => [row.id, row.stock]));

  const othersHold = new Map<string, number>();
  for (const group of await tx.stockHold.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds }, holder: { not: input.holder }, expiresAt: { gt: now } },
    _sum: { quantity: true },
  })) {
    othersHold.set(group.variantId, group._sum.quantity ?? 0);
  }

  const missing = input.items
    .filter(
      (item) =>
        (stock.get(item.variantId) ?? 0) - (othersHold.get(item.variantId) ?? 0) < item.quantity,
    )
    .map((item) => item.title);
  if (missing.length > 0) return { sold: false, missing };

  for (const item of input.items) {
    await tx.productVariant.update({
      where: { id: item.variantId },
      data: { stock: { decrement: item.quantity } },
    });
    await tx.stockMovement.create({
      data: {
        variantId: item.variantId,
        change: -item.quantity,
        reason: "sale confirmed",
        orderId: input.orderId,
      },
    });
  }
  // The buyer's own holds, live or lapsed, have done their job.
  await tx.stockHold.deleteMany({
    where: { variantId: { in: variantIds }, holder: input.holder },
  });

  return { sold: true };
}
