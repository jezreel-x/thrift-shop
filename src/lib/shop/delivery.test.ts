import { describe, expect, it } from "vitest";

import {
  type DeliveryOptions,
  deliveryFee,
  offersChoice,
  parseDeliveryForm,
  rememberedChoice,
} from "./delivery";

const KILIMANI = { id: "kil", name: "Kilimani", feeCents: 25_000 };
const CBD = { id: "cbd", name: "CBD", feeCents: 15_000 };
const BOTH: DeliveryOptions = { pickupAddress: "HH Towers, 4th floor", areas: [CBD, KILIMANI] };

describe("parseDeliveryForm", () => {
  it("takes pickup, at the shop's address", () => {
    expect(parseDeliveryForm({ fulfilment: "PICKUP" }, BOTH)).toEqual({
      ok: true,
      choice: { fulfilment: "PICKUP", pickupAddress: "HH Towers, 4th floor" },
    });
  });

  it("takes delivery to an area, with a landmark and a rider phone in canonical form", () => {
    expect(
      parseDeliveryForm(
        {
          fulfilment: "DELIVERY",
          area: "kil",
          address: "  Kindaruma Rd,   Blue Gate ",
          phone: "0712 345 678",
        },
        BOTH,
      ),
    ).toEqual({
      ok: true,
      choice: {
        fulfilment: "DELIVERY",
        area: KILIMANI,
        address: "Kindaruma Rd, Blue Gate",
        phone: "254712345678",
      },
    });
  });

  it("says what is missing for a delivery", () => {
    const result = parseDeliveryForm({ fulfilment: "DELIVERY", area: "mars", phone: "12" }, BOTH);

    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["address", "area", "phone"]);
  });

  it("refuses what the shop doesn't offer", () => {
    const deliveryOnly = { pickupAddress: null, areas: [CBD] };

    expect(parseDeliveryForm({ fulfilment: "PICKUP" }, deliveryOnly)).toMatchObject({ ok: false });
    expect(parseDeliveryForm({}, BOTH)).toMatchObject({ ok: false });
  });
});

describe("rememberedChoice", () => {
  const remembered = {
    fulfilment: "DELIVERY" as const,
    deliveryAreaId: "kil",
    deliveryAddress: "Blue Gate",
    deliveryPhone: "254712345678",
  };

  it("uses last time's choice while the shop still offers it, at today's fee", () => {
    const raised = { ...BOTH, areas: [{ ...KILIMANI, feeCents: 30_000 }] };

    expect(deliveryFee(rememberedChoice(remembered, raised))).toBe(30_000);
  });

  it("asks again when the area or the pickup point has gone", () => {
    expect(rememberedChoice(remembered, { ...BOTH, areas: [CBD] })).toBeNull();
    expect(
      rememberedChoice({ ...remembered, fulfilment: "PICKUP" }, { ...BOTH, pickupAddress: null }),
    ).toBeNull();
  });
});

describe("offersChoice and deliveryFee", () => {
  it("asks nothing when the shop has set up neither", () => {
    expect(offersChoice({ pickupAddress: null, areas: [] })).toBe(false);
    expect(offersChoice({ pickupAddress: null, areas: [CBD] })).toBe(true);
  });

  it("charges for delivery only", () => {
    expect(deliveryFee({ fulfilment: "PICKUP", pickupAddress: "x" })).toBe(0);
    expect(deliveryFee(null)).toBe(0);
  });
});
