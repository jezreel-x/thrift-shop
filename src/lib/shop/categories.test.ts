import { describe, expect, it } from "vitest";

import { normaliseCategorySlug, offersOption2, sizesAcross } from "./categories";

const LETTERS = { option2Values: ["XS", "S", "M", "L", "XL", "XXL"] };
const WAISTS = { option2Values: ["28", "30", "32", "34"] };

describe("normaliseCategorySlug", () => {
  it("reads links made before categories were data", () => {
    // ?category=WIDE_LEG_SWEATPANTS from an old WhatsApp message still works.
    expect(normaliseCategorySlug("WIDE_LEG_SWEATPANTS")).toBe("wide-leg-sweatpants");
    expect(normaliseCategorySlug("HOODIES")).toBe("hoodies");
  });

  it("leaves a slug as it is", () => {
    expect(normaliseCategorySlug("t-shirts")).toBe("t-shirts");
  });
});

describe("offersOption2", () => {
  it("accepts a value the category offers", () => {
    expect(offersOption2(LETTERS, "M")).toBe(true);
    expect(offersOption2(WAISTS, "32")).toBe(true);
  });

  it("rejects one it does not, including near misses", () => {
    // Values are chosen from a list, so anything else is a bug upstream.
    // Coercing "m" to "M" would let two spellings of one size into the
    // database, which is what makes a size filter useless.
    expect(offersOption2(LETTERS, "W32")).toBe(false);
    expect(offersOption2(LETTERS, "m")).toBe(false);
    expect(offersOption2(LETTERS, " M")).toBe(false);
    expect(offersOption2(WAISTS, "M")).toBe(false);
  });
});

describe("sizesAcross", () => {
  it("de-duplicates sizes shared across categories, keeping the offered order", () => {
    expect(sizesAcross([LETTERS, LETTERS])).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });

  it("puts each category's own sizes after the earlier ones", () => {
    expect(sizesAcross([LETTERS, WAISTS])).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "28",
      "30",
      "32",
      "34",
    ]);
  });
});
