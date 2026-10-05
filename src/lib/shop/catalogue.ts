import { Condition, Gender } from "@/generated/prisma/enums";

/**
 * Labels and orders for the fixed vocabularies: condition and fit.
 *
 * Categories and their sizes used to live here too. They are data now — rows the
 * owner manages, each with its own size list — in src/lib/shop/categories.ts.
 */

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

/** Conditions from best to worst, which is the order a filter should list them in. */
export const CONDITIONS = [
  Condition.NEW_WITH_TAGS,
  Condition.EXCELLENT,
  Condition.GOOD,
  Condition.FAIR,
] as const;

export const GENDERS = [Gender.MENS, Gender.WOMENS, Gender.UNISEX] as const;
