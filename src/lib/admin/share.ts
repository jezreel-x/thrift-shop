import { formatPrice } from "../money";

/**
 * The message "Share to WhatsApp" writes: what the owner would type to post a
 * product to a customer, a group or their Status.
 *
 *   Cargo Pants — from KSh 1,400
 *   Colours: Khaki, Black
 *   Sizes: M, L, XL
 *   https://shop.example/products/cargo-pants
 *
 * Only what can be bought right now, so nobody asks for a size that has gone.
 */
export function shareMessage(input: {
  title: string;
  /** Prices of the variants that can be bought, each its own or the base. */
  pricesCents: number[];
  colours: string[];
  sizes: string[];
  option1Name?: string | null;
  option2Name?: string | null;
  url: string;
}): string {
  const lowest = Math.min(...input.pricesCents);
  const varies = new Set(input.pricesCents).size > 1;
  const price = `${varies ? "from " : ""}${formatPrice(lowest)}`;

  return [
    `${input.title} — ${price}`,
    line(plural(input.option1Name ?? "Colour"), input.colours),
    line(plural(input.option2Name ?? "Size"), input.sizes),
    input.url,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Left out when there is nothing to choose between. */
function line(name: string, values: string[]): string | null {
  const distinct = [...new Set(values)];

  return distinct.length > 0 ? `${name}: ${distinct.join(", ")}` : null;
}

function plural(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}
