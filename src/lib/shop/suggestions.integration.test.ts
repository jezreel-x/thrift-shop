import { describe, expect, it } from "vitest";

import { Category } from "@/generated/prisma/enums";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { reserveVariant } from "./reservations";
import { listSuggestions, suggestionScore } from "./suggestions";

cleanDatabaseBetweenTests();

/** Products created a minute apart, so "newest first" is not an accident. */
let minute = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, minute++));

describe("suggestionScore", () => {
  const cart = { categoryIds: new Set(["hoodies"]), sizes: new Set(["M"]) };

  it("ranks the same kind in the shopper's size above the same kind, above anything", () => {
    expect(suggestionScore({ categoryId: "hoodies", sizes: ["M"] }, cart)).toBe(2);
    expect(suggestionScore({ categoryId: "hoodies", sizes: ["XL"] }, cart)).toBe(1);
    expect(suggestionScore({ categoryId: "tees", sizes: ["M"] }, cart)).toBe(0);
    expect(suggestionScore({ categoryId: null, sizes: [] }, cart)).toBe(0);
  });
});

describe("listSuggestions", () => {
  it("puts the same kind in the shopper's size first, then the same kind, then the rest", async () => {
    const inCart = await makeProduct({
      slug: "in-cart",
      category: Category.HOODIES,
      createdAt: at(),
    });
    await makeProduct({ slug: "tee-m", category: Category.T_SHIRTS, createdAt: at() });
    await makeProduct(
      { slug: "hoodie-xl", category: Category.HOODIES, createdAt: at() },
      { option2: "XL" },
    );
    await makeProduct({ slug: "hoodie-m", category: Category.HOODIES, createdAt: at() });

    const suggestions = await listSuggestions({ productIds: [inCart.id], sizes: ["M"] });

    expect(suggestions.map((card) => card.slug)).toEqual(["hoodie-m", "hoodie-xl", "tee-m"]);
  });

  it("never suggests what is in the cart, sold out, or held by someone else", async () => {
    const inCart = await makeProduct({ slug: "in-cart", createdAt: at() });
    await makeProduct({ slug: "sold", createdAt: at() }, { stock: 0 });
    const held = await makeProduct({ slug: "held", createdAt: at() });
    await reserveVariant(held.variantId, "someone-else");
    await makeProduct({ slug: "buyable", createdAt: at() });

    const suggestions = await listSuggestions({ productIds: [inCart.id], sizes: ["M"] });

    expect(suggestions.map((card) => card.slug)).toEqual(["buyable"]);
  });

  it("does not count the shopper's own hold against them", async () => {
    const inCart = await makeProduct({ slug: "in-cart", createdAt: at() });
    const mine = await makeProduct({ slug: "mine-held", createdAt: at() });
    await reserveVariant(mine.variantId, "me");

    const suggestions = await listSuggestions({
      productIds: [inCart.id],
      sizes: [],
      viewer: "me",
    });

    expect(suggestions.map((card) => card.slug)).toEqual(["mine-held"]);
  });

  it("offers four at most, as ready-to-use catalogue cards", async () => {
    const inCart = await makeProduct({ slug: "in-cart", createdAt: at() });
    for (let index = 0; index < 6; index += 1) await makeProduct({ createdAt: at() });

    const suggestions = await listSuggestions({ productIds: [inCart.id], sizes: [] });

    expect(suggestions).toHaveLength(4);
    expect(suggestions[0]).toMatchObject({
      availability: "AVAILABLE",
      quickAdd: { maxQuantity: 1 },
    });
    expect(await db.product.count()).toBe(7);
  });
});
