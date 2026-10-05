import { prisma } from "../prisma";
import { freeUnits } from "./availability";
import { type ProductCard, getProductCards } from "./products";
import { getAvailability } from "./reservations";

/**
 * "You may also like", under the cart: what a shop assistant would bring over.
 *
 * No recommendation engine — a few honest rules, best first:
 *
 *   1. the same kind of thing, in a size the shopper is already buying
 *   2. the same kind of thing, any size
 *   3. anything else, newest first
 *
 * Only what can be bought right now, and never what is already in the cart.
 * Order history ("often bought together") can join as a rule once there is
 * enough of it to mean something.
 */

export const SUGGESTION_COUNT = 4;

/** How well a candidate fits the cart. Pure, so the ranking is unit-tested. */
export function suggestionScore(
  candidate: { categoryId: string | null; sizes: string[] },
  cart: { categoryIds: Set<string>; sizes: Set<string> },
): number {
  const sameKind = candidate.categoryId !== null && cart.categoryIds.has(candidate.categoryId);
  const fits = candidate.sizes.some((size) => cart.sizes.has(size));

  return sameKind ? (fits ? 2 : 1) : 0;
}

export async function listSuggestions(input: {
  /** Products already in the cart: excluded, and what the rules follow. */
  productIds: string[];
  /** Option-2 values in the cart: "M", "32". */
  sizes: string[];
  /** The shopper, so their own holds do not make something look taken. */
  viewer?: string;
  limit?: number;
}): Promise<ProductCard[]> {
  const limit = input.limit ?? SUGGESTION_COUNT;

  const [inCart, candidates] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: input.productIds } },
      select: { categoryId: true },
    }),
    prisma.product.findMany({
      where: {
        deletedAt: null,
        id: { notIn: input.productIds },
        variants: { some: { stock: { gt: 0 } } },
      },
      select: {
        id: true,
        categoryId: true,
        createdAt: true,
        variants: { select: { id: true, option2: true } },
      },
    }),
  ]);

  const availability = await getAvailability(
    candidates.flatMap((candidate) => candidate.variants.map((variant) => variant.id)),
    input.viewer,
  );
  const cart = {
    categoryIds: new Set(
      inCart.flatMap((product) => (product.categoryId ? [product.categoryId] : [])),
    ),
    sizes: new Set(input.sizes),
  };

  const ranked = candidates
    .map((candidate) => {
      // Only sizes that can actually be bought count towards "fits".
      const buyable = candidate.variants.filter((variant) => {
        const counts = availability.get(variant.id);
        return counts !== undefined && freeUnits(counts) > 0;
      });

      return {
        id: candidate.id,
        createdAt: candidate.createdAt,
        buyable: buyable.length > 0,
        score: suggestionScore(
          {
            categoryId: candidate.categoryId,
            sizes: buyable.flatMap((variant) => (variant.option2 ? [variant.option2] : [])),
          },
          cart,
        ),
      };
    })
    .filter((candidate) => candidate.buyable)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, limit);

  return getProductCards(ranked.map((candidate) => candidate.id));
}
