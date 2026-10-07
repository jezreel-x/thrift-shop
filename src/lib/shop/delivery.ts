import { Fulfilment } from "@/generated/prisma/enums";
import { normalisePhone } from "../phone";

/**
 * How an order reaches the buyer: collected from the shop, or delivered to an
 * area the shop serves, for that area's fee.
 *
 * Asked at checkout before anything is reserved, like the buyer's phone, so
 * the fifteen-minute hold is not spent typing; remembered on the account, so
 * the next order asks for nothing. Pure, so every rule is unit-tested.
 *
 * Areas rather than street addresses because that is how Nairobi riders and
 * their fees work: "Kilimani, Blue Gate opposite Naivas", not a postcode.
 */

export type DeliveryArea = { id: string; name: string; feeCents: number };

/** What the shop offers. Neither set: checkout asks nothing, as before. */
export type DeliveryOptions = { pickupAddress: string | null; areas: DeliveryArea[] };

export type DeliveryChoice =
  | { fulfilment: typeof Fulfilment.PICKUP; pickupAddress: string }
  | {
      fulfilment: typeof Fulfilment.DELIVERY;
      area: DeliveryArea;
      /** Building, street, landmark. */
      address: string;
      /** Who the rider calls, canonical 2547XXXXXXXX. */
      phone: string;
    };

/** What a buyer has on their account from last time. */
export type RememberedDelivery = {
  fulfilment: Fulfilment | null;
  deliveryAreaId: string | null;
  deliveryAddress: string | null;
  deliveryPhone: string | null;
};

export const MAX_ADDRESS = 200;

export function offersChoice(options: DeliveryOptions): boolean {
  return options.pickupAddress !== null || options.areas.length > 0;
}

export function deliveryFee(choice: DeliveryChoice | null): number {
  return choice?.fulfilment === Fulfilment.DELIVERY ? choice.area.feeCents : 0;
}

/**
 * Last time's choice, if the shop still offers it. A removed area or a
 * withdrawn pickup point means asking again rather than quietly guessing.
 */
export function rememberedChoice(
  remembered: RememberedDelivery,
  options: DeliveryOptions,
): DeliveryChoice | null {
  if (remembered.fulfilment === Fulfilment.PICKUP && options.pickupAddress) {
    return { fulfilment: Fulfilment.PICKUP, pickupAddress: options.pickupAddress };
  }

  if (remembered.fulfilment === Fulfilment.DELIVERY) {
    const area = options.areas.find((candidate) => candidate.id === remembered.deliveryAreaId);
    if (area && remembered.deliveryAddress && remembered.deliveryPhone) {
      return {
        fulfilment: Fulfilment.DELIVERY,
        area,
        address: remembered.deliveryAddress,
        phone: remembered.deliveryPhone,
      };
    }
  }

  return null;
}

export type DeliveryField = "fulfilment" | "area" | "address" | "phone";

export type DeliveryParse =
  | { ok: true; choice: DeliveryChoice }
  | { ok: false; errors: Partial<Record<DeliveryField, string>> };

/** The checkout's delivery step, read and checked against what the shop offers. */
export function parseDeliveryForm(
  fields: Partial<Record<DeliveryField, string>>,
  options: DeliveryOptions,
): DeliveryParse {
  if (fields.fulfilment === Fulfilment.PICKUP) {
    return options.pickupAddress
      ? {
          ok: true,
          choice: { fulfilment: Fulfilment.PICKUP, pickupAddress: options.pickupAddress },
        }
      : { ok: false, errors: { fulfilment: "Pickup isn't available. Choose delivery." } };
  }

  if (fields.fulfilment !== Fulfilment.DELIVERY || options.areas.length === 0) {
    return { ok: false, errors: { fulfilment: "Choose how you'd like to get your order." } };
  }

  const errors: Partial<Record<DeliveryField, string>> = {};
  const area = options.areas.find((candidate) => candidate.id === fields.area);
  if (!area) errors.area = "Choose your area.";

  const address = (fields.address ?? "").trim().replace(/\s+/g, " ");
  if (address.length < 3) {
    errors.address = "Say where the rider should come: building, street or a landmark.";
  } else if (address.length > MAX_ADDRESS) {
    errors.address = `At most ${MAX_ADDRESS} characters.`;
  }

  const phone = normalisePhone(fields.phone ?? "");
  if (!phone) errors.phone = "That isn't a Kenyan mobile number. Try 0712 345 678.";

  if (!area || !phone || Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, choice: { fulfilment: Fulfilment.DELIVERY, area, address, phone } };
}
