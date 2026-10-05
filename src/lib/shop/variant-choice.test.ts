import { describe, expect, it } from "vitest";

import { type ChoiceVariant, priceSummary, resolveChoice, swatchSlug } from "./variant-choice";

const KHAKI = { id: "k", name: "Khaki", hex: "#c3b091" };
const BLACK = { id: "b", name: "Black", hex: "#111111" };
const WAISTS = ["28", "30", "32", "34", "36", "38"];

let n = 0;
const v = (
  swatchId: string | null,
  option2: string | null,
  stock: number,
  extra: Partial<ChoiceVariant> = {},
): ChoiceVariant => ({
  id: `v${++n}`,
  swatchId,
  option2,
  priceCents: null,
  stock,
  heldByOthers: 0,
  ...extra,
});

/** Cargo Pants: Khaki 30/32/36 (36 sold out), Black 32/38 (38 at KSh 1,600). */
const cargo = () => {
  const variants = [
    v("k", "32", 2),
    v("k", "30", 3),
    v("k", "36", 0),
    v("b", "32", 1),
    v("b", "38", 4, { priceCents: 160_000 }),
  ];
  return { variants, swatches: [KHAKI, BLACK], option2Order: WAISTS, basePriceCents: 140_000 };
};

describe("swatchSlug", () => {
  it("makes a URL-safe name", () => {
    expect(swatchSlug("Rose gold")).toBe("rose-gold");
    expect(swatchSlug("  Navy / White ")).toBe("navy-white");
  });
});

describe("resolveChoice — a thrift item", () => {
  it("needs no choice when there is one variant without options", () => {
    const only = v(null, "M", 1);

    const choice = resolveChoice({
      variants: [only],
      swatches: [],
      option2Order: ["S", "M", "L"],
      basePriceCents: 95_000,
      selection: {},
    });

    // One size is selected for the buyer: nothing to pick, straight to the cart.
    expect(choice).toMatchObject({ needs: null, priceCents: 95_000, priceIsFrom: false, free: 1 });
    expect(choice.variant?.id).toBe(only.id);
  });
});

describe("resolveChoice — colour and size", () => {
  it("opens on the first colour that can be bought, with no size chosen yet", () => {
    const choice = resolveChoice({ ...cargo(), selection: {} });

    expect(choice.swatches.find((s) => s.selected)?.name).toBe("Khaki");
    expect(choice.needs).toBe("option2");
    expect(choice.variant).toBeNull();
  });

  it("lists sizes in the category's order, marking sold-out ones rather than hiding them", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "khaki" } });

    expect(choice.option2.map((o) => [o.value, o.soldOut])).toEqual([
      ["30", false],
      ["32", false],
      ["36", true],
    ]);
  });

  it("offers only the sizes made in the chosen colour", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "black" } });

    expect(choice.option2.map((o) => o.value)).toEqual(["32", "38"]);
  });

  it("resolves the variant, its free units and its own price once both are chosen", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "black", option2: "38" } });

    expect(choice).toMatchObject({ needs: null, priceCents: 160_000, priceIsFrom: false, free: 4 });
  });

  it("shows a From price while the remaining choices differ in price", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "black" } });

    expect(choice).toMatchObject({ priceCents: 140_000, priceIsFrom: true });
  });

  it("ignores a size the colour does not come in, rather than inventing a variant", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "black", option2: "30" } });

    expect(choice.variant).toBeNull();
    expect(choice.needs).toBe("option2");
  });

  it("ignores an unknown colour in the URL and falls back to one that can be bought", () => {
    const choice = resolveChoice({ ...cargo(), selection: { option1: "purple" } });

    expect(choice.swatches.find((s) => s.selected)?.name).toBe("Khaki");
  });

  it("counts other shoppers' holds: a size whose units are all held shows as sold out", () => {
    const { variants, ...rest } = cargo();
    variants[3] = { ...variants[3], heldByOthers: 1 }; // Black 32: 1 in stock, 1 held

    const choice = resolveChoice({ variants, ...rest, selection: { option1: "black" } });

    expect(choice.option2.find((o) => o.value === "32")?.soldOut).toBe(true);
  });

  it("marks a colour sold out when nothing in it is free", () => {
    const { variants, ...rest } = cargo();
    const allGone = variants.map((variant) =>
      variant.swatchId === "b" ? { ...variant, stock: 0 } : variant,
    );

    const choice = resolveChoice({ variants: allGone, ...rest, selection: {} });

    expect(choice.swatches.find((s) => s.name === "Black")?.soldOut).toBe(true);
  });
});

describe("resolveChoice — one option only", () => {
  it("earrings: metal only, no sizes", () => {
    const gold = v("g", null, 4);
    const silver = v("s", null, 0);

    const choice = resolveChoice({
      variants: [gold, silver],
      swatches: [
        { id: "g", name: "Gold", hex: null },
        { id: "s", name: "Silver", hex: null },
      ],
      option2Order: [],
      basePriceCents: 120_000,
      selection: { option1: "silver" },
    });

    expect(choice.option2).toEqual([]);
    expect(choice.variant?.id).toBe(silver.id);
    expect(choice.free).toBe(0);
  });
});

describe("priceSummary", () => {
  it("shows the lowest price among what can still be bought", () => {
    expect(
      priceSummary(
        [
          { priceCents: 100_000, stock: 0, heldByOthers: 0 },
          { priceCents: 160_000, stock: 2, heldByOthers: 0 },
        ],
        140_000,
      ),
    ).toEqual({ priceCents: 160_000, varies: true });
  });

  it("falls back to the base price for variants without their own", () => {
    expect(priceSummary([{ priceCents: null, stock: 1, heldByOthers: 0 }], 95_000)).toEqual({
      priceCents: 95_000,
      varies: false,
    });
  });
});
