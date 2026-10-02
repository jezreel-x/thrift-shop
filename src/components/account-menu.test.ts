import { describe, expect, it } from "vitest";

import { initialsOf } from "./account-menu";

describe("initialsOf", () => {
  it("uses first and last name", () => {
    expect(initialsOf("Grace Wanjiku", "grace@example.com")).toBe("GW");
    expect(initialsOf("  mary  watiri  njeri ", "m@example.com")).toBe("MN");
  });

  it("uses a single name's first letter", () => {
    expect(initialsOf("grace", "grace@example.com")).toBe("G");
  });

  it("falls back to the email when there is no name", () => {
    expect(initialsOf(null, "otieno@example.com")).toBe("O");
    expect(initialsOf("   ", "baraka@example.com")).toBe("B");
  });
});
