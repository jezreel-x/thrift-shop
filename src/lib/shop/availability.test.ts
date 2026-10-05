import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_RANK,
  MAX_PER_LINE,
  freeUnits,
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
  it("offers what is free, but never more than a line allows", () => {
    expect(maxQuantity({ stock: 2, heldByOthers: 0 })).toBe(2);
    expect(maxQuantity({ stock: 40, heldByOthers: 1 })).toBe(MAX_PER_LINE);
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
