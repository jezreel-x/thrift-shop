import { describe, expect, it } from "vitest";

import { Category, Condition } from "@/generated/prisma/enums";
import { CATEGORIES, CONDITIONS, SIZES_BY_CATEGORY, allSizes, isValidSize } from "./catalogue";

describe("isValidSize", () => {
  it("accepts a size offered for the category", () => {
    expect(isValidSize(Category.BOTTOMS, "W32")).toBe(true);
    expect(isValidSize(Category.SHOES, "UK 9")).toBe(true);
    expect(isValidSize(Category.BAGS, "One size")).toBe(true);
  });

  it("rejects a size belonging to a different category", () => {
    expect(isValidSize(Category.SHOES, "W32")).toBe(false);
    expect(isValidSize(Category.TOPS, "UK 8")).toBe(false);
    expect(isValidSize(Category.BAGS, "M")).toBe(false);
  });

  it("rejects near misses rather than normalising them", () => {
    // Sizes are chosen from a list, so anything else is a bug upstream. Coercing
    // "w32" to "W32" here would hide it and let two spellings of one size into
    // the database, which is precisely what makes a size filter useless.
    expect(isValidSize(Category.TOPS, "m")).toBe(false);
    expect(isValidSize(Category.TOPS, " M")).toBe(false);
    expect(isValidSize(Category.BOTTOMS, "w32")).toBe(false);
    expect(isValidSize(Category.SHOES, "UK9")).toBe(false);
  });
});

describe("the size lists themselves", () => {
  // These guard against edits to the vocabulary, which is hand-maintained data
  // rather than code. The type system cannot see a duplicated or missing entry.

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
    // "UK 8" is both a dress size and a shoe size; the unscoped filter shows one.
    expect(sizes.filter((size) => size === "UK 8")).toHaveLength(1);
  });
});

describe("CONDITIONS", () => {
  it("covers every condition in the enum", () => {
    // CONDITIONS is hand-ordered best-to-worst, so `as const` cannot enforce that
    // it stays complete. Adding a condition to the schema without adding it here
    // would silently drop an option from the filter, with no compile error.
    expect([...CONDITIONS].sort()).toEqual(Object.values(Condition).sort());
  });
});
