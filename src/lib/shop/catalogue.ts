import { Category, Condition, Gender, ProductStatus } from "@/generated/prisma/enums";

/**
 * The catalogue's controlled vocabulary.
 *
 * `Product.size` is a plain string in the database — the moment the shop stocks
 * jeans or shoes, one column has to hold "M", "W32" and "UK 8" alike, and a
 * database enum would make each of those a migration. The permitted values live
 * here instead: writes are validated against this list, so the data stays clean
 * enough to filter on without the schema having to know what a size is.
 */

const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

/**
 * Which sizes are offered for each category.
 *
 * Every current category is letter-sized, so this map is uniform today and the
 * repetition is deliberate rather than accidental. It is kept per-category
 * because the first pair of jeans ("W32") or shoes ("UK 9") breaks the
 * uniformity, and that arrives as data in this file rather than as a change to
 * how sizing works.
 */
export const SIZES_BY_CATEGORY: Record<Category, readonly string[]> = {
  [Category.HOODIES]: LETTER_SIZES,
  [Category.SWEATSHIRTS]: LETTER_SIZES,
  [Category.T_SHIRTS]: LETTER_SIZES,
  [Category.FLANNELS]: LETTER_SIZES,
  [Category.SWEATPANTS]: LETTER_SIZES,
  [Category.WIDE_LEG_SWEATPANTS]: LETTER_SIZES,
  [Category.SIDE_POCKET_PANTS]: LETTER_SIZES,
  [Category.UNDERWEAR]: LETTER_SIZES,
};

/** True when `size` is one of the values permitted for `category`. */
export function isValidSize(category: Category, size: string): boolean {
  return SIZES_BY_CATEGORY[category].includes(size);
}

/**
 * Every size in the catalogue, de-duplicated, for the filter UI before a
 * category has been chosen. Order follows the category order above rather than
 * being sorted, because "XS, S, M, L" is the useful order and alphabetical is
 * actively wrong for sizes.
 */
export function allSizes(): string[] {
  return [...new Set(Object.values(SIZES_BY_CATEGORY).flat())];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  [Category.HOODIES]: "Hoodies",
  [Category.SWEATSHIRTS]: "Sweatshirts",
  [Category.T_SHIRTS]: "T-shirts",
  [Category.FLANNELS]: "Flannels",
  [Category.SWEATPANTS]: "Sweatpants",
  [Category.WIDE_LEG_SWEATPANTS]: "Wide-leg sweatpants",
  [Category.SIDE_POCKET_PANTS]: "Side-pocket pants",
  [Category.UNDERWEAR]: "Underwear",
};

export const GENDER_LABELS: Record<Gender, string> = {
  [Gender.MENS]: "Men's",
  [Gender.WOMENS]: "Women's",
  [Gender.UNISEX]: "Unisex",
};

/**
 * Condition wording shown to buyers. Deliberately plain: "Excellent" and "Good"
 * mean more to someone judging a photograph than a grading scale would.
 */
export const CONDITION_LABELS: Record<Condition, string> = {
  [Condition.NEW_WITH_TAGS]: "New with tags",
  [Condition.EXCELLENT]: "Excellent",
  [Condition.GOOD]: "Good",
  [Condition.FAIR]: "Fair",
};

export const STATUS_LABELS: Record<ProductStatus, string> = {
  [ProductStatus.AVAILABLE]: "Available",
  [ProductStatus.RESERVED]: "Reserved",
  [ProductStatus.SOLD]: "Sold",
};

/**
 * Categories in the order the listing page should offer them — tops first, then
 * bottoms, then underwear, which is roughly how the shop describes itself.
 */
export const CATEGORIES = [
  Category.HOODIES,
  Category.SWEATSHIRTS,
  Category.T_SHIRTS,
  Category.FLANNELS,
  Category.SWEATPANTS,
  Category.WIDE_LEG_SWEATPANTS,
  Category.SIDE_POCKET_PANTS,
  Category.UNDERWEAR,
] as const;

/** Conditions from best to worst, which is the order a filter should list them in. */
export const CONDITIONS = [
  Condition.NEW_WITH_TAGS,
  Condition.EXCELLENT,
  Condition.GOOD,
  Condition.FAIR,
] as const;

export const GENDERS = [Gender.MENS, Gender.WOMENS, Gender.UNISEX] as const;
