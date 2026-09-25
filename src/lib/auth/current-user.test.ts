import { describe, expect, it } from "vitest";

import { safeReturnTo } from "./current-user";

describe("safeReturnTo", () => {
  it("keeps a path within the site", () => {
    expect(safeReturnTo("/checkout")).toBe("/checkout");
    expect(safeReturnTo("/products/grey-hoodie?size=M")).toBe("/products/grey-hoodie?size=M");
  });

  it("falls back when there is nothing to return to", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo(undefined, "/cart")).toBe("/cart");
  });

  it("refuses to send anyone off the site", () => {
    // An open redirect turns our own sign-in page into a phishing link: the
    // visitor authenticates here, lands on a convincing copy, and types their
    // password again.
    for (const hostile of [
      "https://evil.example/login",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeReturnTo(hostile)).toBe("/");
    }
  });
});
