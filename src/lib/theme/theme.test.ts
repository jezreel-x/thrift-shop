import { describe, expect, it } from "vitest";

import { parseStoredTheme, parseTheme } from "./theme";

describe("parseStoredTheme", () => {
  it("reads a stored light or dark choice", () => {
    expect(parseStoredTheme("light")).toBe("light");
    expect(parseStoredTheme("dark")).toBe("dark");
  });

  it("treats a missing, tampered or stale cookie as following the device", () => {
    expect(parseStoredTheme(undefined)).toBeNull();
    expect(parseStoredTheme("system")).toBeNull();
    expect(parseStoredTheme("DARK")).toBeNull();
    expect(parseStoredTheme('dark" onload="alert(1)')).toBeNull();
  });
});

describe("parseTheme", () => {
  it("accepts the three real options", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("rejects anything else a form post could carry", () => {
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme("sepia")).toBeNull();
    expect(parseTheme(new File([], "dark"))).toBeNull();
  });
});
