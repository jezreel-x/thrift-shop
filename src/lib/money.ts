/**
 * Money is stored, passed around and compared as an integer number of cents
 * (KES minor units). Floats are never used: `0.1 + 0.2 !== 0.3`, and a rounding
 * error on a price is a real shilling gained or lost.
 */

export const CURRENCY_CODE = "KES";
export const CURRENCY_SYMBOL = "KSh";

const CENTS_PER_SHILLING = 100;

/** Thrown when user- or seed-supplied price text cannot be read as an amount. */
export class InvalidPriceError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid price ${JSON.stringify(input)}: ${reason}`);
    this.name = "InvalidPriceError";
  }
}

/**
 * Formats cents for display, e.g. `150000` -> `"KSh 1,500"`.
 *
 * Kenyan prices are quoted in whole shillings in practice, so a round amount
 * drops the decimals entirely; a non-round one keeps both places rather than
 * silently hiding part of the price.
 */
export function formatPrice(cents: number): string {
  assertValidCents(cents);

  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const shillings = Math.trunc(absolute / CENTS_PER_SHILLING);
  const remainder = absolute % CENTS_PER_SHILLING;

  const grouped = shillings.toLocaleString("en-KE");
  const decimals = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;

  return `${negative ? "-" : ""}${CURRENCY_SYMBOL} ${grouped}${decimals}`;
}

/**
 * Reads a human-written price into cents, e.g. `"1,500.50"` -> `150050`.
 *
 * Accepts an optional currency symbol and thousands separators because that is
 * how prices arrive from an admin form or a pasted WhatsApp listing. Anything
 * finer than a cent is rejected rather than rounded, so a typo surfaces at the
 * boundary instead of becoming a wrong price in the database.
 */
export function parsePriceToCents(input: string): number {
  const cleaned = input
    .trim()
    .replace(new RegExp(`^${CURRENCY_SYMBOL}`, "i"), "")
    .replace(new RegExp(`^${CURRENCY_CODE}`, "i"), "")
    .trim()
    .replace(/,/g, "");

  if (cleaned === "") {
    throw new InvalidPriceError(input, "no amount given");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new InvalidPriceError(
      input,
      "expected a non-negative amount with at most two decimal places",
    );
  }

  const [shillings, fraction = ""] = cleaned.split(".");
  const cents = Number(shillings) * CENTS_PER_SHILLING + Number(fraction.padEnd(2, "0"));

  if (!Number.isSafeInteger(cents)) {
    throw new InvalidPriceError(input, "amount is too large");
  }

  return cents;
}

function assertValidCents(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Money must be an integer number of cents, received ${cents}`);
  }
}
