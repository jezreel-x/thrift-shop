import { describe, expect, it } from "vitest";

import { formatAge, formatDateTime } from "./dates";

describe("formatDateTime", () => {
  it("shows Nairobi time, three hours ahead of UTC, wherever the server is", () => {
    expect(formatDateTime(new Date("2026-09-30T06:12:00Z"))).toMatch(/09:12/);
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const ago = (ms: number) => formatAge(new Date(now.getTime() - ms), now);

  it("rounds down into the unit a person would use", () => {
    expect(ago(20_000)).toBe("just now");
    expect(ago(12 * 60_000)).toBe("12 min ago");
    expect(ago(3 * 3_600_000 + 59 * 60_000)).toBe("3 h ago");
    expect(ago(26 * 3_600_000)).toBe("1 day ago");
    expect(ago(3 * 86_400_000)).toBe("3 days ago");
  });
});
