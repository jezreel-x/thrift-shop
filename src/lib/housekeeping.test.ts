import { describe, expect, it } from "vitest";

import { isCronRequest } from "./housekeeping";

describe("isCronRequest", () => {
  it("accepts exactly the bearer secret", () => {
    expect(isCronRequest("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("refuses a wrong, partial or missing secret", () => {
    expect(isCronRequest("Bearer s3cre", "s3cret")).toBe(false);
    expect(isCronRequest("s3cret", "s3cret")).toBe(false);
    expect(isCronRequest(null, "s3cret")).toBe(false);
  });

  it("refuses everyone when no secret is configured", () => {
    expect(isCronRequest("Bearer ", "")).toBe(false);
    expect(isCronRequest("Bearer undefined", undefined)).toBe(false);
  });
});
