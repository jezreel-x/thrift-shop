import { describe, expect, it } from "vitest";

import { describeLine, orderMessage } from "./whatsapp-order";

const CARGO = {
  title: "Cargo Pants",
  swatch: "Khaki",
  size: "32",
  quantity: 2,
  priceCents: 140_000,
};
const TEE = { title: "Black t shirt", swatch: null, size: "L", quantity: 1, priceCents: 40_000 };

describe("describeLine", () => {
  it("names the item, its options, how many and what they cost together", () => {
    expect(describeLine(CARGO)).toBe("Cargo Pants · Khaki · 32 × 2 — KSh 2,800");
  });

  it("leaves out what the item does not have", () => {
    expect(describeLine(TEE)).toBe("Black t shirt · L — KSh 400");
    expect(describeLine({ ...TEE, size: null })).toBe("Black t shirt — KSh 400");
  });
});

describe("orderMessage", () => {
  it("reads as one sentence for one item, with the link the buyer was looking at", () => {
    expect(orderMessage([CARGO], "https://shop.example/products/cargo-pants?option2=32")).toBe(
      "Hi, I'd like to order Cargo Pants · Khaki · 32 × 2 — KSh 2,800.\n" +
        "https://shop.example/products/cargo-pants?option2=32",
    );
  });

  it("lists several items with a total", () => {
    expect(orderMessage([CARGO, TEE])).toBe(
      "Hi, I'd like to order:\n" +
        "• Cargo Pants · Khaki · 32 × 2 — KSh 2,800\n" +
        "• Black t shirt · L — KSh 400\n" +
        "Total: KSh 3,200",
    );
  });
});
