import { describe, expect, it } from "vitest";

import { fitWithin, toHex } from "./prepare-photo";

describe("fitWithin", () => {
  it("shrinks the longest edge to the limit, keeping the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("toHex", () => {
  it("writes bytes as lowercase hex, two digits each", () => {
    expect(toHex(new Uint8Array([0, 15, 171, 255]).buffer)).toBe("000fabff");
  });
});
