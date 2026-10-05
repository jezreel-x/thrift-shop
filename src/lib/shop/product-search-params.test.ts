import { describe, expect, it } from "vitest";

import { Condition, Gender } from "@/generated/prisma/enums";
import { buildProductQuery, hasActiveFilters, parseProductQuery } from "./product-search-params";

// What the database offers: the categories created by the migration, and their sizes.
const VOCABULARY = {
  categories: ["hoodies", "sweatshirts", "t-shirts", "flannels"],
  sizes: ["XS", "S", "M", "L", "XL", "XXL"],
};

const parse = (raw: Parameters<typeof parseProductQuery>[0]) => parseProductQuery(raw, VOCABULARY);

describe("parseProductQuery — reading filters", () => {
  it("reads a single value and a repeated one", () => {
    expect(parse({ size: "M" }).filters.sizes).toEqual(["M"]);
    expect(parse({ size: ["M", "L"] }).filters.sizes).toEqual(["M", "L"]);
  });

  it("reads categories, conditions and genders", () => {
    const { filters } = parse({
      category: ["hoodies", "t-shirts"],
      condition: Condition.EXCELLENT,
      gender: Gender.WOMENS,
    });

    expect(filters.categories).toEqual(["hoodies", "t-shirts"]);
    expect(filters.conditions).toEqual([Condition.EXCELLENT]);
    expect(filters.genders).toEqual([Gender.WOMENS]);
  });

  it("de-duplicates a value repeated in the URL", () => {
    expect(parse({ size: ["M", "M", "L"] }).filters.sizes).toEqual(["M", "L"]);
  });

  it("converts prices from shillings to cents", () => {
    const { filters } = parse({ min: "500", max: "2000" });

    expect(filters.minPriceCents).toBe(50_000);
    expect(filters.maxPriceCents).toBe(200_000);
  });

  it("accepts one bound without the other", () => {
    expect(parse({ min: "500" }).filters).toEqual({ minPriceCents: 50_000 });
    expect(parse({ max: "500" }).filters).toEqual({ maxPriceCents: 50_000 });
  });

  it("swaps a range given backwards", () => {
    // Someone dragged a slider past itself. Swapping gives them what they meant.
    const { filters } = parse({ min: "2000", max: "500" });

    expect(filters.minPriceCents).toBe(50_000);
    expect(filters.maxPriceCents).toBe(200_000);
  });

  it("trims the search term and ignores a blank one", () => {
    expect(parse({ q: "  nike  " }).filters.search).toBe("nike");
    expect(parse({ q: "   " }).filters.search).toBeUndefined();
  });
});

describe("parseProductQuery — surviving nonsense", () => {
  // A query string is arbitrary text. None of these may produce an error page.

  it("drops values that are not in the vocabulary", () => {
    const { filters } = parse({
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
    const { filters } = parse({ size: ['\'; drop table "Product"; --', "<script>"] });

    expect(filters.sizes).toBeUndefined();
  });

  it("ignores prices that are not sensible numbers", () => {
    for (const value of ["abc", "-100", "", "   ", "NaN", "Infinity"]) {
      expect(parse({ min: value }).filters.minPriceCents).toBeUndefined();
    }
  });

  it("falls back to page one for anything that is not a positive integer", () => {
    for (const value of ["0", "-5", "abc", "1.5", "", " 2 ", "+2", "0x10"]) {
      expect(parse({ page: value }).page).toBe(1);
    }
  });

  it("rejects exponential notation, which Number() would read as an integer", () => {
    // Number("1e308") is a positive integer as far as Number.isInteger is
    // concerned, and would reach the database as an OFFSET big enough to fail
    // the query outright.
    expect(parse({ page: "1e3" }).page).toBe(1);
    expect(parse({ page: "1e308" }).page).toBe(1);
  });

  it("caps an absurdly large page rather than passing it to the database", () => {
    expect(parse({ page: "999999999999" }).page).toBe(10_000);
  });

  it("falls back to the default sort for an unknown one", () => {
    expect(parse({ sort: "cheapest" }).sort).toBe("newest");
    expect(parse({}).sort).toBe("newest");
  });

  it("returns an empty, usable query for an empty URL", () => {
    const query = parse({});

    expect(query).toEqual({ filters: {}, sort: "newest", page: 1 });
  });

  it("takes the first value when a single-valued param is repeated", () => {
    expect(parse({ page: ["2", "9"] }).page).toBe(2);
    expect(parse({ sort: ["price-asc", "price-desc"] }).sort).toBe("price-asc");
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
        categories: ["hoodies"],
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

    expect(parse(raw)).toEqual(original);
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

describe("category links made before categories were data", () => {
  it("still filter: HOODIES and WIDE_LEG names read as their slugs", () => {
    expect(parse({ category: ["HOODIES", "T_SHIRTS"] }).filters.categories).toEqual([
      "hoodies",
      "t-shirts",
    ]);
  });
});
