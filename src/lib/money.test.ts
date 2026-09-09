import { describe, expect, it } from "vitest";

import { InvalidPriceError, formatPrice, parsePriceToCents } from "./money";

describe("formatPrice", () => {
  it("drops decimals for whole shilling amounts", () => {
    expect(formatPrice(150000)).toBe("KSh 1,500");
  });

  it("groups thousands", () => {
    expect(formatPrice(1234567800)).toBe("KSh 12,345,678");
  });

  it("keeps both decimal places when there is a remainder", () => {
    expect(formatPrice(150050)).toBe("KSh 1,500.50");
    expect(formatPrice(150005)).toBe("KSh 1,500.05");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("KSh 0");
  });

  it("formats negative amounts, as a refund line would need", () => {
    expect(formatPrice(-50000)).toBe("-KSh 500");
  });

  it("refuses a non-integer, which would mean money reached it as a float", () => {
    expect(() => formatPrice(1500.5)).toThrow(TypeError);
  });
});

describe("parsePriceToCents", () => {
  it("reads a plain whole amount", () => {
    expect(parsePriceToCents("1500")).toBe(150000);
  });

  it("reads thousands separators and decimals", () => {
    expect(parsePriceToCents("1,500.50")).toBe(150050);
  });

  it("pads a single decimal place", () => {
    expect(parsePriceToCents("1500.5")).toBe(150050);
  });

  it("tolerates a currency symbol or code and surrounding space", () => {
    expect(parsePriceToCents("  KSh 1,500 ")).toBe(150000);
    expect(parsePriceToCents("KES 1500")).toBe(150000);
  });

  it("reads zero", () => {
    expect(parsePriceToCents("0")).toBe(0);
  });

  it.each(["", "   ", "abc", "1500.555", "-1500", "1500-", "1.5.0", "1e3"])(
    "rejects %o rather than guessing",
    (input) => {
      expect(() => parsePriceToCents(input)).toThrow(InvalidPriceError);
    },
  );

  it("round-trips through formatPrice", () => {
    for (const amount of ["0", "1500", "1,500.50", "99,999.99"]) {
      const cents = parsePriceToCents(amount);
      expect(parsePriceToCents(formatPrice(cents))).toBe(cents);
    }
  });
});
