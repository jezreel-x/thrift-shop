/**
 * Kenyan mobile numbers.
 *
 * Stored in one canonical form — `254712345678` — because the shop matches them
 * against M-Pesa messages and WhatsApp, and "0712 345 678", "+254712345678" and
 * "254 712 345678" are the same person. Storing whatever was typed means the
 * owner searching for a buyer finds nothing.
 */

/**
 * Safaricom and Airtel mobile numbers begin 7 or 1 after the country code.
 * Landlines and short codes are not something a buyer can be reached on.
 */
const MOBILE_PREFIX = /^2547\d{8}$|^2541\d{8}$/;

/**
 * Reduces a typed number to `254XXXXXXXXX`, or null when it is not a Kenyan
 * mobile number.
 *
 * Accepts the four ways people actually write them — leading zero, leading plus,
 * bare country code, or the nine digits alone — because rejecting a number that
 * is obviously correct is a worse failure than accepting a few odd spacings.
 */
export function normalisePhone(input: string): string | null {
  // Spaces, dashes and brackets are presentation, and everybody uses them
  // differently.
  const digits = input.replace(/[\s()-]/g, "").replace(/^\+/, "");

  if (!/^\d+$/.test(digits)) return null;

  const canonical = digits.startsWith("254")
    ? digits
    : digits.startsWith("0")
      ? `254${digits.slice(1)}`
      : // Nine digits with no prefix at all: "712345678".
        digits.length === 9
        ? `254${digits}`
        : digits;

  return MOBILE_PREFIX.test(canonical) ? canonical : null;
}

/** `254712345678` as `0712 345 678`, which is how a Kenyan reads it back. */
export function formatPhone(canonical: string): string {
  if (!MOBILE_PREFIX.test(canonical)) return canonical;

  const local = `0${canonical.slice(3)}`;

  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
