import { describe, expect, it } from "vitest";

import { Category, Condition, Gender } from "@/generated/prisma/enums";
import { buildProductQuery, hasActiveFilters, parseProductQuery } from "./product-search-params";

describe("parseProductQuery — reading filters", () => {
  it("reads a single value and a repeated one", () => {
    expect(parseProductQuery({ size: "M" }).filters.sizes).toEqual(["M"]);
    expect(parseProductQuery({ size: ["M", "L"] }).filters.sizes).toEqual(["M", "L"]);
  });

  it("reads categories, conditions and genders", () => {
    const { filters } = parseProductQuery({
      category: [Category.HOODIES, Category.T_SHIRTS],
      condition: Condition.EXCELLENT,
      gender: Gender.WOMENS,
    });

    expect(filters.categories).toEqual([Category.HOODIES, Category.T_SHIRTS]);
    expect(filters.conditions).toEqual([Condition.EXCELLENT]);
    expect(filters.genders).toEqual([Gender.WOMENS]);
  });

  it("de-duplicates a value repeated in the URL", () => {
    expect(parseProductQuery({ size: ["M", "M", "L"] }).filters.sizes).toEqual(["M", "L"]);
  });

  it("converts prices from shillings to cents", () => {
    const { filters } = parseProductQuery({ min: "500", max: "2000" });

    expect(filters.minPriceCents).toBe(50_000);
    expect(filters.maxPriceCents).toBe(200_000);
  });

  it("accepts one bound without the other", () => {
    expect(parseProductQuery({ min: "500" }).filters).toEqual({ minPriceCents: 50_000 });
    expect(parseProductQuery({ max: "500" }).filters).toEqual({ maxPriceCents: 50_000 });
  });

  it("swaps a range given backwards", () => {
    // Someone dragged a slider past itself. Swapping gives them what they meant.
    const { filters } = parseProductQuery({ min: "2000", max: "500" });

    expect(filters.minPriceCents).toBe(50_000);
    expect(filters.maxPriceCents).toBe(200_000);
  });

  it("trims the search term and ignores a blank one", () => {
    expect(parseProductQuery({ q: "  nike  " }).filters.search).toBe("nike");
    expect(parseProductQuery({ q: "   " }).filters.search).toBeUndefined();
  });
});

describe("parseProductQuery — surviving nonsense", () => {
  // A query string is arbitrary text. None of these may produce an error page.

  it("drops values that are not in the vocabulary", () => {
    const { filters } = parseProductQuery({
      size: ["M", "BANANA", "UK 8"],
      category: "NOT_A_CATEGORY",
      condition: "PRISTINE",
      gender: "OTHER",
    });

    expect(filters.sizes).toEqual(["M"]);
    expect(filters.categories).toBeUndefined();
    expect(filters.conditions).toBeUndefined();
    expect(filters.genders).toBeUndefined();
  });

  it("refuses to let anything unrecognised reach the size filter", () => {
    // `sizes` becomes a SQL IN clause, so the allow-list is the real boundary.
    const { filters } = parseProductQuery({ size: ['\'; drop table "Product"; --', "<script>"] });

    expect(filters.sizes).toBeUndefined();
  });

  it("ignores prices that are not sensible numbers", () => {
    for (const value of ["abc", "-100", "", "   ", "NaN", "Infinity"]) {
      expect(parseProductQuery({ min: value }).filters.minPriceCents).toBeUndefined();
    }
  });

  it("falls back to page one for anything that is not a positive integer", () => {
    for (const value of ["0", "-5", "abc", "1.5", "", " 2 ", "+2", "0x10"]) {
      expect(parseProductQuery({ page: value }).page).toBe(1);
    }
  });

  it("rejects exponential notation, which Number() would read as an integer", () => {
    // Number("1e308") is a positive integer as far as Number.isInteger is
    // concerned, and would reach the database as an OFFSET big enough to fail
    // the query outright.
    expect(parseProductQuery({ page: "1e3" }).page).toBe(1);
    expect(parseProductQuery({ page: "1e308" }).page).toBe(1);
  });

  it("caps an absurdly large page rather than passing it to the database", () => {
    expect(parseProductQuery({ page: "999999999999" }).page).toBe(10_000);
  });

  it("falls back to the default sort for an unknown one", () => {
    expect(parseProductQuery({ sort: "cheapest" }).sort).toBe("newest");
    expect(parseProductQuery({}).sort).toBe("newest");
  });

  it("returns an empty, usable query for an empty URL", () => {
    const query = parseProductQuery({});

    expect(query).toEqual({ filters: {}, sort: "newest", page: 1 });
  });

  it("takes the first value when a single-valued param is repeated", () => {
    expect(parseProductQuery({ page: ["2", "9"] }).page).toBe(2);
    expect(parseProductQuery({ sort: ["price-asc", "price-desc"] }).sort).toBe("price-asc");
  });
});

describe("buildProductQuery", () => {
  it("omits defaults, so the unfiltered catalogue is a single URL", () => {
    // Two URLs serving one page split its search ranking between them.
    expect(buildProductQuery({})).toBe("/");
    expect(buildProductQuery({ filters: {}, sort: "newest", page: 1 })).toBe("/");
  });

  it("repeats a key for each value of a multi-select", () => {
    expect(buildProductQuery({ filters: { sizes: ["M", "L"] } })).toBe("?size=M&size=L");
  });

  it("writes prices back as shillings", () => {
    expect(buildProductQuery({ filters: { minPriceCents: 50_000, maxPriceCents: 200_000 } })).toBe(
      "?min=500&max=2000",
    );
  });

  it("includes a non-default sort and a page past the first", () => {
    expect(buildProductQuery({ sort: "price-asc", page: 3 })).toBe("?sort=price-asc&page=3");
  });

  it("round-trips a fully specified query", () => {
    const original = {
      filters: {
        sizes: ["M", "L"],
        categories: [Category.HOODIES],
        conditions: [Condition.GOOD],
        genders: [Gender.UNISEX],
        minPriceCents: 50_000,
        maxPriceCents: 200_000,
        search: "nike",
      },
      sort: "price-desc" as const,
      page: 2,
    };

    const url = new URLSearchParams(buildProductQuery(original).slice(1));
    const raw: Record<string, string | string[]> = {};
    for (const key of new Set(url.keys())) {
      const values = url.getAll(key);
      raw[key] = values.length > 1 ? values : values[0];
    }

    expect(parseProductQuery(raw)).toEqual(original);
  });
});

describe("hasActiveFilters", () => {
  it("is false for no filters and for empty lists", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ sizes: [], categories: [] })).toBe(false);
  });

  it("is true when anything narrows the catalogue", () => {
    expect(hasActiveFilters({ sizes: ["M"] })).toBe(true);
    expect(hasActiveFilters({ search: "nike" })).toBe(true);
    expect(hasActiveFilters({ minPriceCents: 0 })).toBe(true);
  });
});
