import { describe, expect, it } from "vitest";

import { describeRulesChange, parseShopRules } from "./shop-rules";

describe("parseShopRules", () => {
  it("reads a whole number of at least 1, or no limit", () => {
    expect(parseShopRules({ maxPerItem: " 20 ", noLimit: false })).toEqual({
      ok: true,
      value: { maxPerItem: 20 },
    });
    expect(parseShopRules({ maxPerItem: "whatever", noLimit: true })).toEqual({
      ok: true,
      value: { maxPerItem: null },
    });
  });

  it("refuses nothing, zero, fractions and four digits", () => {
    for (const maxPerItem of ["", "0", "2.5", "1000", "-3"]) {
      expect(parseShopRules({ maxPerItem, noLimit: false }).ok).toBe(false);
    }
  });
});

describe("describeRulesChange", () => {
  it("says what the limit was and is, in words", () => {
    expect(describeRulesChange({ maxPerItem: 5 }, { maxPerItem: 20 })).toEqual([
      "Most of one item per order: 5 → 20",
    ]);
    expect(describeRulesChange({ maxPerItem: 20 }, { maxPerItem: null })).toEqual([
      "Most of one item per order: 20 → no limit",
    ]);
  });
});
