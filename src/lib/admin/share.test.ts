import { describe, expect, it } from "vitest";

import { shareMessage } from "./share";

const URL = "https://shop.example/products/cargo-pants";

describe("shareMessage", () => {
  it("names the product, its lowest price, and what it comes in", () => {
    expect(
      shareMessage({
        title: "Cargo Pants",
        pricesCents: [140_000, 160_000, 140_000],
        colours: ["Khaki", "Black", "Khaki"],
        sizes: ["M", "L", "M"],
        option2Name: "Waist",
        url: URL,
      }),
    ).toBe("Cargo Pants — from KSh 1,400\nColours: Khaki, Black\nWaists: M, L\n" + URL);
  });

  it("drops 'from' when every option costs the same, and lines with nothing in them", () => {
    expect(
      shareMessage({ title: "Oud", pricesCents: [250_000], colours: [], sizes: [], url: URL }),
    ).toBe(`Oud — KSh 2,500\n${URL}`);
  });
});
