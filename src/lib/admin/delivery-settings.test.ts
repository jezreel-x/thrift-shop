import { describe, expect, it } from "vitest";

import { describeDeliveryChanges, parseDeliverySettings } from "./delivery-settings";

describe("parseDeliverySettings", () => {
  it("reads the pickup point and the areas, skipping empty rows", () => {
    expect(
      parseDeliverySettings({
        pickupAddress: "  HH Towers,  4th floor ",
        areas: [
          { id: "a", name: " Westlands ", fee: "250" },
          { id: null, name: "", fee: "" },
          { id: null, name: "CBD", fee: "0" },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        pickupAddress: "HH Towers, 4th floor",
        areas: [
          { id: "a", name: "Westlands", feeCents: 25_000 },
          { id: null, name: "CBD", feeCents: 0 },
        ],
      },
    });
  });

  it("treats an empty pickup point as no pickup", () => {
    const result = parseDeliverySettings({ pickupAddress: " ", areas: [] });

    expect(result.ok && result.value).toEqual({ pickupAddress: null, areas: [] });
  });

  it("files each problem under its row", () => {
    const result = parseDeliverySettings({
      pickupAddress: "",
      areas: [
        { id: null, name: "Westlands", fee: "250" },
        { id: null, name: "westlands", fee: "300" },
        { id: null, name: "Rongai", fee: "four hundred" },
        { id: null, name: "", fee: "100" },
        { id: null, name: "Karen", fee: "2500000" },
      ],
    });

    expect(!result.ok && result.errors).toEqual({
      "area:1": "westlands is listed twice.",
      "area:2": "Enter the fee, such as 250, or 0 for free.",
      "area:3": "Name the area.",
      "area:4": "That fee looks too high.",
    });
  });
});

describe("describeDeliveryChanges", () => {
  it("says what was added, repriced, removed and moved", () => {
    expect(
      describeDeliveryChanges(
        {
          pickupAddress: null,
          areas: [
            { name: "Westlands", feeCents: 25_000 },
            { name: "Karen", feeCents: 50_000 },
          ],
        },
        {
          pickupAddress: "HH Towers",
          areas: [
            { name: "Westlands", feeCents: 30_000 },
            { name: "CBD", feeCents: 0 },
          ],
        },
      ),
    ).toEqual([
      "Pickup point: (none) → HH Towers",
      "Westlands: KSh 250 → KSh 300",
      "Added CBD (free)",
      "Removed Karen",
    ]);
  });
});
