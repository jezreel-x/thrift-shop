import { describe, expect, it } from "vitest";

import { pagesToShow } from "./pagination";

describe("pagesToShow", () => {
  it("lists every page when there are few enough", () => {
    expect(pagesToShow(1, 3)).toEqual([1, 2, 3]);
  });

  it("shows the first, the last, and the current page with its neighbours", () => {
    expect(pagesToShow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("opens no gap where pages are already adjacent", () => {
    // Page 3 of 5 reaches both ends without a break: 1,2,3,4,5.
    expect(pagesToShow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not repeat the first or last page when the window reaches them", () => {
    expect(pagesToShow(2, 10)).toEqual([1, 2, 3, "gap", 10]);
    expect(pagesToShow(9, 10)).toEqual([1, "gap", 8, 9, 10]);
  });

  it("handles a single page", () => {
    expect(pagesToShow(1, 1)).toEqual([1]);
  });

  it("never emits a page outside the range, even for a page past the end", () => {
    // parseProductQuery caps rather than clamps, so ?page=9999 on a two-page
    // catalogue reaches this function. It must not invent pages 9998 or 10000.
    const pages = pagesToShow(9999, 2).filter((entry): entry is number => entry !== "gap");

    expect(pages.every((page) => page >= 1 && page <= 2)).toBe(true);
  });

  it("keeps pages in ascending order", () => {
    const pages = pagesToShow(7, 12).filter((entry): entry is number => entry !== "gap");

    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });
});
