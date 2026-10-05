import { freeUnits } from "./availability";

/**
 * What a buyer has picked on a product page, and what follows from it.
 *
 * Pure, so every rule here is unit-tested: which colour and size are selected,
 * which sizes exist in that colour and which have sold out, which variant that
 * makes, and what it costs. The page renders the answer; the choice itself
 * lives in the URL (?option1=khaki&option2=32), so it works without JavaScript
 * and can be shared as a link.
 */

export type ChoiceVariant = {
  id: string;
  swatchId: string | null;
  option2: string | null;
  priceCents: number | null;
  stock: number;
  heldByOthers: number;
};

export type ChoiceSwatch = { id: string; name: string; hex: string | null };

export type Selection = { option1?: string; option2?: string };

export type SwatchOption = ChoiceSwatch & {
  slug: string;
  selected: boolean;
  /** Nothing free in any size of this colour. */
  soldOut: boolean;
};

export type Option2Option = {
  value: string;
  selected: boolean;
  /** Exists in the selected colour, but nothing is free. */
  soldOut: boolean;
};

export type Choice = {
  swatches: SwatchOption[];
  option2: Option2Option[];
  /** The exact variant, once every option the product has is chosen. */
  variant: ChoiceVariant | null;
  /** What is still to choose before it can go in a cart. */
  needs: "option1" | "option2" | null;
  /** The chosen variant's price, or the lowest of what is still possible. */
  priceCents: number;
  /** True when priceCents is a "From" price because choices still differ. */
  priceIsFrom: boolean;
  /** Units the buyer could take of the chosen variant. 0 until one is chosen. */
  free: number;
};

/** "Rose gold" → "rose-gold": how a swatch appears in the URL. */
export function swatchSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function effectivePrice(variant: Pick<ChoiceVariant, "priceCents">, baseCents: number) {
  return variant.priceCents ?? baseCents;
}

/**
 * The price a card shows: the lowest among what can still be bought (or among
 * everything, if nothing can), and whether the variants differ — "From KSh …".
 */
export function priceSummary(
  variants: Pick<ChoiceVariant, "priceCents" | "stock" | "heldByOthers">[],
  baseCents: number,
): { priceCents: number; varies: boolean } {
  const prices = (pool: typeof variants) => pool.map((v) => effectivePrice(v, baseCents));
  const buyable = variants.filter((variant) => freeUnits(variant) > 0);
  const all = prices(variants);
  const shown = prices(buyable.length > 0 ? buyable : variants);

  return {
    priceCents: shown.length > 0 ? Math.min(...shown) : baseCents,
    varies: new Set(all).size > 1,
  };
}

export function resolveChoice(input: {
  variants: ChoiceVariant[];
  swatches: ChoiceSwatch[];
  /** The category's option-2 values, in the order it offers them. */
  option2Order: string[];
  basePriceCents: number;
  selection: Selection;
}): Choice {
  const { variants, swatches, option2Order, basePriceCents, selection } = input;
  const hasOption1 = swatches.length > 0;
  const hasOption2 = variants.some((variant) => variant.option2 !== null);

  const freeIn = (swatchId: string) =>
    variants.some((variant) => variant.swatchId === swatchId && freeUnits(variant) > 0);

  // Colour: the one asked for; the only one; else the first that can be bought,
  // so the page opens on photos of something available.
  const selectedSwatch = hasOption1
    ? (swatches.find((swatch) => swatchSlug(swatch.name) === selection.option1) ??
      (swatches.length === 1 ? swatches[0] : undefined) ??
      swatches.find((swatch) => freeIn(swatch.id)) ??
      swatches[0])
    : null;

  // Sizes that exist in that colour (all of them, when there is no option 1),
  // in the category's order, with anything unknown to it after.
  const inColour = hasOption1
    ? variants.filter((variant) => variant.swatchId === selectedSwatch?.id)
    : variants;
  const rank = (value: string) => {
    const index = option2Order.indexOf(value);
    return index === -1 ? option2Order.length : index;
  };
  const sizes = hasOption2
    ? inColour
        .filter(
          (variant): variant is ChoiceVariant & { option2: string } => variant.option2 !== null,
        )
        .sort((a, b) => rank(a.option2) - rank(b.option2) || a.option2.localeCompare(b.option2))
    : [];

  const askedFor = sizes.find((variant) => variant.option2 === selection.option2);
  const selectedOption2 = hasOption2
    ? (askedFor?.option2 ?? (sizes.length === 1 ? sizes[0].option2 : null))
    : null;

  const variant =
    (hasOption2 && selectedOption2 === null) || (hasOption1 && !selectedSwatch)
      ? null
      : (inColour.find((candidate) => candidate.option2 === selectedOption2) ?? null);

  const needs: Choice["needs"] =
    hasOption1 && !selectedSwatch
      ? "option1"
      : hasOption2 && selectedOption2 === null
        ? "option2"
        : null;

  const summary = priceSummary(inColour.length > 0 ? inColour : variants, basePriceCents);

  return {
    swatches: swatches.map((swatch) => ({
      ...swatch,
      slug: swatchSlug(swatch.name),
      selected: swatch.id === selectedSwatch?.id,
      soldOut: !freeIn(swatch.id),
    })),
    option2: sizes.map((size) => ({
      value: size.option2,
      selected: size.option2 === selectedOption2,
      soldOut: freeUnits(size) <= 0,
    })),
    variant,
    needs,
    priceCents: variant ? effectivePrice(variant, basePriceCents) : summary.priceCents,
    priceIsFrom: !variant && summary.varies,
    free: variant ? freeUnits(variant) : 0,
  };
}
