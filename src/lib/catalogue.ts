import { Category, Condition, ProductStatus } from "@/generated/prisma/enums";

/**
 * The catalogue's controlled vocabulary.
 *
 * `Product.size` is a plain string in the database — one column has to hold
 * "M", "UK 8" and "W32" depending on what the garment is, and a database enum
 * would need a migration the first time the shop stocks a size system nobody
 * anticipated. The permitted values live here instead: writes are validated
 * against this list, so the data stays clean enough to filter on without the
 * schema having to know what a size is.
 */

const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

/** Jeans and trousers are sold by waist measurement far more often than by letter. */
const WAIST_SIZES = ["W26", "W28", "W30", "W32", "W34", "W36", "W38", "W40"] as const;

/** UK dress sizes, which is what Nairobi thrift stock is almost always labelled in. */
const DRESS_SIZES = ["UK 6", "UK 8", "UK 10", "UK 12", "UK 14", "UK 16", "UK 18", "UK 20"] as const;

const SHOE_SIZES = [
  "UK 3",
  "UK 4",
  "UK 5",
  "UK 6",
  "UK 7",
  "UK 8",
  "UK 9",
  "UK 10",
  "UK 11",
  "UK 12",
] as const;

const ONE_SIZE = ["One size"] as const;

/**
 * Which sizes are offered for each category.
 *
 * Note that "UK 8" means a dress size under DRESSES and a shoe size under
 * SHOES. That ambiguity is harmless while the size filter is scoped to a
 * chosen category, and it is the reason the listing page groups sizes by
 * category rather than presenting one flat list.
 */
export const SIZES_BY_CATEGORY: Record<Category, readonly string[]> = {
  [Category.TOPS]: LETTER_SIZES,
  [Category.BOTTOMS]: [...LETTER_SIZES, ...WAIST_SIZES],
  [Category.DRESSES]: [...LETTER_SIZES, ...DRESS_SIZES],
  [Category.OUTERWEAR]: LETTER_SIZES,
  [Category.SHOES]: SHOE_SIZES,
  [Category.BAGS]: ONE_SIZE,
  [Category.ACCESSORIES]: ONE_SIZE,
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
  [Category.TOPS]: "Tops",
  [Category.BOTTOMS]: "Bottoms",
  [Category.DRESSES]: "Dresses",
  [Category.OUTERWEAR]: "Outerwear",
  [Category.SHOES]: "Shoes",
  [Category.BAGS]: "Bags",
  [Category.ACCESSORIES]: "Accessories",
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

/** Categories in the order the listing page should offer them. */
export const CATEGORIES = Object.values(Category);

/** Conditions from best to worst, which is the order a filter should list them in. */
export const CONDITIONS = [
  Condition.NEW_WITH_TAGS,
  Condition.EXCELLENT,
  Condition.GOOD,
  Condition.FAIR,
] as const;
