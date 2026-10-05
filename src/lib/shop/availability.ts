/**
 * What a shopper can take, from stock and holds. Pure, so the rules are unit
 * tested directly; the queries that feed it live in reservations.ts.
 */

/** Never more than this many of one variant in a cart line or an order line. */
export const MAX_PER_LINE = 5;

export type VariantAvailability = {
  /** Units in the shop and not yet sold. */
  stock: number;
  /** Units in other shoppers' unexpired holds. */
  heldByOthers: number;
};

/** Units this shopper could take right now. Never negative. */
export function freeUnits({ stock, heldByOthers }: VariantAvailability): number {
  return Math.max(0, stock - heldByOthers);
}

/** The most this shopper may put on one line: what is free, capped per line. */
export function maxQuantity(availability: VariantAvailability): number {
  return Math.min(freeUnits(availability), MAX_PER_LINE);
}

/**
 * A product's state for its card and page, from its variants.
 *
 * Named as the old ProductStatus values on purpose: the catalogue's badges and
 * its sort read the same three words as before.
 *
 *   AVAILABLE  some variant has a free unit
 *   RESERVED   units remain, but every one is in somebody's checkout
 *   SOLD       nothing left in any variant
 */
export type ProductAvailability = "AVAILABLE" | "RESERVED" | "SOLD";

export function productAvailability(variants: VariantAvailability[]): ProductAvailability {
  if (variants.some((variant) => freeUnits(variant) > 0)) return "AVAILABLE";
  if (variants.some((variant) => variant.stock > 0)) return "RESERVED";

  return "SOLD";
}

/** The order the catalogue ranks them in: buyable first, sold last. */
export const AVAILABILITY_RANK: Record<ProductAvailability, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  SOLD: 2,
};
