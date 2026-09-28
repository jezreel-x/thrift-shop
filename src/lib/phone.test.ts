import { describe, expect, it } from "vitest";

import { formatPhone, normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it("accepts the four ways people write the same number", () => {
    for (const written of ["0712345678", "+254712345678", "254712345678", "712345678"]) {
      expect(normalisePhone(written)).toBe("254712345678");
    }
  });

  it("ignores spacing and punctuation", () => {
    for (const written of ["0712 345 678", "+254 712 345 678", "0712-345-678", "(0712) 345678"]) {
      expect(normalisePhone(written)).toBe("254712345678");
    }
  });

  it("accepts the 01 range as well as 07", () => {
    expect(normalisePhone("0112345678")).toBe("254112345678");
  });

  it("rejects what a buyer cannot be reached on", () => {
    for (const written of [
      "0812345678", // not a mobile prefix
      "071234567", // a digit short
      "07123456789", // a digit long
      "254812345678",
      "",
      "not a number",
      "0712 345 67a",
    ]) {
      expect(normalisePhone(written)).toBeNull();
    }
  });

  it("is idempotent, so re-saving a stored number does not mangle it", () => {
    const once = normalisePhone("0712345678")!;

    expect(normalisePhone(once)).toBe(once);
  });
});

describe("formatPhone", () => {
  it("shows a stored number the way a Kenyan reads it", () => {
    expect(formatPhone("254712345678")).toBe("0712 345 678");
  });

  it("returns anything unrecognised untouched rather than mangling it", () => {
    expect(formatPhone("whatever")).toBe("whatever");
  });
});
