import { describe, expect, it } from "vitest";

import { productSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Vintage Levis Straight Jeans")).toBe("vintage-levis-straight-jeans");
  });

  it("drops punctuation rather than encoding it", () => {
    expect(slugify("Levi's 501 — W32/L34!")).toBe("levi-s-501-w32-l34");
  });

  it("folds accents so the word survives", () => {
    expect(slugify("Étoile Sézane blouse")).toBe("etoile-sezane-blouse");
  });

  it("reads & as a word, since titles use it that way", () => {
    expect(slugify("Dolce & Gabbana")).toBe("dolce-and-gabbana");
  });

  it("collapses runs of separators and trims the ends", () => {
    expect(slugify("  ---Nike   Air??Max--- ")).toBe("nike-air-max");
  });

  it("keeps digits, which carry size and model information", () => {
    expect(slugify("Air Max 90")).toBe("air-max-90");
  });

  it("returns empty when nothing usable survives", () => {
    expect(slugify("!!! ???")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("truncates at a word boundary rather than mid-word", () => {
    const slug = slugify("a".repeat(30) + " " + "b".repeat(30) + " " + "c".repeat(30));

    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toBe(`${"a".repeat(30)}-${"b".repeat(30)}`);
  });

  it("truncates hard when a single word exceeds the limit", () => {
    expect(slugify("z".repeat(120))).toBe("z".repeat(80));
  });

  it("never leaves a trailing hyphen", () => {
    for (const input of ["hello---", "!!!hello!!!", "a".repeat(79) + " b"]) {
      expect(slugify(input)).not.toMatch(/-$/);
    }
  });
});

describe("productSlug", () => {
  it("falls back when the title slugifies to nothing", () => {
    expect(productSlug("???")).toBe("item");
  });

  it("appends a suffix to disambiguate a repeated title", () => {
    expect(productSlug("Black Leather Jacket", "k3f9")).toBe("black-leather-jacket-k3f9");
  });

  it("slugifies the suffix too, so it cannot break the URL", () => {
    expect(productSlug("Jacket", "A B!")).toBe("jacket-a-b");
  });

  it("ignores an empty suffix instead of leaving a trailing hyphen", () => {
    expect(productSlug("Jacket", "")).toBe("jacket");
    expect(productSlug("Jacket", "!!!")).toBe("jacket");
  });
});
