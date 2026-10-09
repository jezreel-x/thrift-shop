import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_RANK,
  DEFAULT_MAX_PER_ITEM,
  clampQuantity,
  freeUnits,
  limitNote,
  quantityLimit,
  maxQuantity,
  productAvailability,
} from "./availability";

describe("freeUnits", () => {
  it("is stock less other shoppers' holds, never negative", () => {
    expect(freeUnits({ stock: 5, heldByOthers: 2 })).toBe(3);
    // The owner may lower stock below what is already held.
    expect(freeUnits({ stock: 1, heldByOthers: 3 })).toBe(0);
  });
});

describe("maxQuantity", () => {
  it("offers what is free, but never more than the shop's per-item limit", () => {
    expect(maxQuantity({ stock: 2, heldByOthers: 0 }, DEFAULT_MAX_PER_ITEM)).toBe(2);
    expect(maxQuantity({ stock: 40, heldByOthers: 1 }, DEFAULT_MAX_PER_ITEM)).toBe(5);
    expect(maxQuantity({ stock: 40, heldByOthers: 1 }, 20)).toBe(20);
  });

  it("offers everything free when the shop sets no limit", () => {
    expect(maxQuantity({ stock: 40, heldByOthers: 1 }, null)).toBe(39);
  });
});

describe("clampQuantity", () => {
  it("keeps a quantity whole, at least 1, and within the limit", () => {
    expect(clampQuantity(3.7, 5)).toBe(3);
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(Number.NaN, 5)).toBe(1);
    expect(clampQuantity(9, 5)).toBe(5);
    expect(clampQuantity(9, null)).toBe(9);
  });
});

describe("productAvailability", () => {
  it("is AVAILABLE while any variant has a free unit", () => {
    expect(
      productAvailability([
        { stock: 0, heldByOthers: 0 },
        { stock: 2, heldByOthers: 1 },
      ]),
    ).toBe("AVAILABLE");
  });

  it("is RESERVED when units remain but all are in someone's checkout", () => {
    expect(productAvailability([{ stock: 1, heldByOthers: 1 }])).toBe("RESERVED");
  });

  it("is SOLD when nothing is left anywhere, or there are no variants at all", () => {
    expect(productAvailability([{ stock: 0, heldByOthers: 0 }])).toBe("SOLD");
    expect(productAvailability([])).toBe("SOLD");
  });

  it("ranks buyable first and sold last", () => {
    expect(AVAILABILITY_RANK.AVAILABLE).toBeLessThan(AVAILABILITY_RANK.RESERVED);
    expect(AVAILABILITY_RANK.RESERVED).toBeLessThan(AVAILABILITY_RANK.SOLD);
  });
});

describe("quantityLimit and limitNote", () => {
  it("says the shop's limit decides when there's more than it allows", () => {
    expect(quantityLimit({ stock: 22, heldByOthers: 0 }, 5)).toEqual({ max: 5, reason: "cap" });
    expect(limitNote("cap", 5)).toMatch(/up to 5 of each item per order/);
  });

  it("says stock decides when there's less, or no limit", () => {
    expect(quantityLimit({ stock: 3, heldByOthers: 0 }, 5)).toEqual({ max: 3, reason: "stock" });
    expect(quantityLimit({ stock: 22, heldByOthers: 2 }, null)).toEqual({
      max: 20,
      reason: "stock",
    });
    expect(limitNote("stock", 3)).toBe("That's all there is right now: 3 left.");
    expect(limitNote("stock", 1)).toBe("That's the last one.");
  });

  it("calls an exact match the shop's limit: that's what stops the next one", () => {
    expect(quantityLimit({ stock: 5, heldByOthers: 0 }, 5).reason).toBe("cap");
  });
});
