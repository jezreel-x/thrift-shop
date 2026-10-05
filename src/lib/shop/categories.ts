import { cache } from "react";

import { prisma } from "../prisma";

/**
 * Categories, as data the owner manages.
 *
 * Each is the template for its products: what option 1 and option 2 are called
 * ("Colour" and "Waist", "Metal" and "Ring size") and which option-2 values it
 * offers, in order. A new kind of stock is a row, not a migration. See
 * docs/product-variants.md.
 */

export type CategoryInfo = {
  id: string;
  slug: string;
  name: string;
  position: number;
  option1Name: string | null;
  option2Name: string | null;
  option2Values: string[];
  showCondition: boolean;
  showFit: boolean;
};

/**
 * Every category, in the shop's order. Memoised for the request: the
 * catalogue page, its metadata and its filters all ask.
 */
export const listCategories = cache((): Promise<CategoryInfo[]> =>
  prisma.productCategory.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      position: true,
      option1Name: true,
      option2Name: true,
      option2Values: true,
      showCondition: true,
      showFit: true,
    },
  }),
);

/**
 * A category value from a URL, in the form slugs take.
 *
 * Links made before categories were data used the old fixed names —
 * ?category=WIDE_LEG_SWEATPANTS — and they still arrive from shared WhatsApp
 * messages and bookmarks. Reading them as wide-leg-sweatpants keeps them working.
 */
export function normaliseCategorySlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Every option-2 value across the given categories, de-duplicated, in the
 * order they are offered — "XS, S, M, L" is the useful order, and alphabetical
 * is actively wrong for sizes.
 */
export function sizesAcross(categories: Pick<CategoryInfo, "option2Values">[]): string[] {
  return [...new Set(categories.flatMap((category) => category.option2Values))];
}

/**
 * Whether a value is one this category offers for option 2.
 *
 * Exact, not normalised: values are chosen from a list, so a near miss ("m",
 * "M ") is a bug upstream, and quietly coercing it would hide that bug.
 */
export function offersOption2(
  category: Pick<CategoryInfo, "option2Values">,
  value: string,
): boolean {
  return category.option2Values.includes(value);
}
