import { describe, expect, it } from "vitest";

import { Category, Condition, Gender } from "@/generated/prisma/enums";
import {
  CATEGORIES,
  CONDITIONS,
  GENDERS,
  SIZES_BY_CATEGORY,
  allSizes,
  isValidSize,
} from "./catalogue";

describe("isValidSize", () => {
  it("accepts a size offered for the category", () => {
    expect(isValidSize(Category.HOODIES, "M")).toBe(true);
    expect(isValidSize(Category.UNDERWEAR, "XS")).toBe(true);
    expect(isValidSize(Category.WIDE_LEG_SWEATPANTS, "XXL")).toBe(true);
  });

  it("rejects a size the shop does not stock at all", () => {
    // Waist and UK sizes are plausible future stock, which is the point: until
    // they are added to the vocabulary they are not valid, so a typo in an
    // import cannot quietly create a size nothing can filter on.
    expect(isValidSize(Category.SWEATPANTS, "W32")).toBe(false);
    expect(isValidSize(Category.HOODIES, "UK 10")).toBe(false);
    expect(isValidSize(Category.T_SHIRTS, "One size")).toBe(false);
  });

  it("rejects near misses rather than normalising them", () => {
    // Sizes are chosen from a list, so anything else is a bug upstream. Coercing
    // "m" to "M" here would hide it and let two spellings of one size into the
    // database, which is precisely what makes a size filter useless.
    expect(isValidSize(Category.HOODIES, "m")).toBe(false);
    expect(isValidSize(Category.HOODIES, " M")).toBe(false);
    expect(isValidSize(Category.FLANNELS, "xl")).toBe(false);
    expect(isValidSize(Category.T_SHIRTS, "")).toBe(false);
  });
});

describe("the size lists themselves", () => {
  // These guard the vocabulary, which is hand-maintained data rather than code.
  // The type system cannot see a duplicated or missing entry.

  it("offers at least one size for every category", () => {
    for (const category of CATEGORIES) {
      expect(SIZES_BY_CATEGORY[category].length).toBeGreaterThan(0);
    }
  });

  it("never repeats a size within a category", () => {
    for (const category of CATEGORIES) {
      const sizes = SIZES_BY_CATEGORY[category];
      expect(new Set(sizes).size).toBe(sizes.length);
    }
  });
});

describe("allSizes", () => {
  it("de-duplicates sizes shared across categories", () => {
    const sizes = allSizes();

    expect(new Set(sizes).size).toBe(sizes.length);
    expect(sizes).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });
});

describe("the ordered lists", () => {
  // CATEGORIES, CONDITIONS and GENDERS are hand-ordered for display, so `as
  // const` cannot enforce that they stay complete. Adding a value to any of
  // these enums without adding it here would silently drop an option from the
  // filter UI, with nothing failing to say so.

  it("covers every category", () => {
    expect([...CATEGORIES].sort()).toEqual(Object.values(Category).sort());
  });

  it("covers every condition, ordered best to worst", () => {
    expect([...CONDITIONS].sort()).toEqual(Object.values(Condition).sort());
    expect(CONDITIONS[0]).toBe(Condition.NEW_WITH_TAGS);
    expect(CONDITIONS.at(-1)).toBe(Condition.FAIR);
  });

  it("covers every gender", () => {
    expect([...GENDERS].sort()).toEqual(Object.values(Gender).sort());
  });
});
