/**
 * What a shopper can take, from stock and holds. Pure, so the rules are unit
 * tested directly; the queries that feed it live in reservations.ts.
 */

/**
 * The most of one item (one colour and size) in an order, unless the owner
 * sets otherwise in Settings → Shop rules. Null there means no limit.
 */
export const DEFAULT_MAX_PER_ITEM = 5;

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

/**
 * The most this shopper may put on one line: what is free, within the shop's
 * per-item limit (null: no limit).
 */
export function maxQuantity(availability: VariantAvailability, cap: number | null): number {
  return cap === null ? freeUnits(availability) : Math.min(freeUnits(availability), cap);
}

/** Why a buyer can't add more: the shop's per-item limit, or what's left. */
export type LimitReason = "cap" | "stock";

/** The most a buyer may have of one item, and what decides it. */
export function quantityLimit(
  availability: VariantAvailability,
  cap: number | null,
): { max: number; reason: LimitReason } {
  const free = freeUnits(availability);

  return cap !== null && cap <= free ? { max: cap, reason: "cap" } : { max: free, reason: "stock" };
}

/**
 * What a buyer is told when + stops, so a greyed-out button isn't a mystery.
 * The shop's limit says why it exists; stock just says there's no more.
 */
export function limitNote(reason: LimitReason, max: number): string {
  if (reason === "cap") {
    return `The shop sells up to ${max} of each item per order, so there's enough to go round.`;
  }

  return max === 1 ? "That's the last one." : `That's all there is right now: ${max} left.`;
}

/** A whole number of at least 1, within the shop's per-item limit (null: no limit). */
export function clampQuantity(quantity: number, cap: number | null): number {
  const whole = Math.max(1, Math.trunc(quantity) || 1);

  return cap === null ? whole : Math.min(cap, whole);
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
