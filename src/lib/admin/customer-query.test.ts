import { describe, expect, it } from "vitest";

import { customerListHref, parseCustomerQuery, searchTerms } from "./customer-query";

describe("parseCustomerQuery", () => {
  it("defaults to newest accounts, first page, no search", () => {
    expect(parseCustomerQuery({})).toEqual({ search: "", sort: "new", page: 1 });
  });

  it("reads a search, a sort and a page, and ignores what it doesn't know", () => {
    expect(parseCustomerQuery({ q: " Achieng ", sort: "spent", page: "2" })).toEqual({
      search: "Achieng",
      sort: "spent",
      page: 2,
    });
    expect(parseCustomerQuery({ sort: "loudest", page: "1e308" })).toMatchObject({
      sort: "new",
      page: 1,
    });
  });
});

describe("customerListHref", () => {
  it("leaves defaults out, so each view has one address", () => {
    expect(customerListHref({ search: "", sort: "new", page: 1 })).toBe("/admin/customers");
    expect(customerListHref({ search: "0712", sort: "recent", page: 3 })).toBe(
      "/admin/customers?q=0712&sort=recent&page=3",
    );
  });
});

describe("searchTerms", () => {
  it("reads a phone number however it was typed", () => {
    expect(searchTerms("0712 345 678").phone).toBe("254712345678");
    expect(searchTerms("+254 712 345678").phone).toBe("254712345678");
  });

  it("leaves anything else as text", () => {
    expect(searchTerms("Achieng")).toEqual({ text: "Achieng", phone: null });
  });
});
