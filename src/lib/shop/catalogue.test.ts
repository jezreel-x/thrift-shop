import { describe, expect, it } from "vitest";

import { Condition, Gender } from "@/generated/prisma/enums";
import { CONDITIONS, GENDERS } from "./catalogue";

describe("the ordered lists", () => {
  // CONDITIONS and GENDERS are hand-ordered for display, so `as const` cannot
  // enforce that they stay complete. Adding a value to either enum without
  // adding it here would silently drop an option from the filter UI, with
  // nothing failing to say so.

  it("covers every condition, ordered best to worst", () => {
    expect([...CONDITIONS].sort()).toEqual(Object.values(Condition).sort());
    expect(CONDITIONS[0]).toBe(Condition.NEW_WITH_TAGS);
    expect(CONDITIONS.at(-1)).toBe(Condition.FAIR);
  });

  it("covers every gender", () => {
    expect([...GENDERS].sort()).toEqual(Object.values(Gender).sort());
  });
});
