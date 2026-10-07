import { describe, expect, it } from "vitest";

import { parseProductQuery, productListHref } from "./product-query";

const SLUGS = ["hoodies", "pants"];

describe("parseProductQuery", () => {
  it("reads a search, a category, withdrawn and a page", () => {
    expect(
      parseProductQuery({ q: " cargo ", category: "pants", show: "withdrawn", page: "3" }, SLUGS),
    ).toEqual({ search: "cargo", category: "pants", withdrawn: true, page: 3 });
  });

  it("treats anything unknown as the default", () => {
    expect(parseProductQuery({ category: "boats", show: "all", page: "1e308" }, SLUGS)).toEqual({
      search: "",
      category: "",
      withdrawn: false,
      page: 1,
    });
  });
});

describe("productListHref", () => {
  it("leaves defaults out, so each view has one address", () => {
    expect(productListHref({ search: "", category: "", withdrawn: false, page: 1 })).toBe(
      "/admin/products",
    );
    expect(productListHref({ category: "pants", withdrawn: true, page: 2 })).toBe(
      "/admin/products?category=pants&show=withdrawn&page=2",
    );
  });
});
