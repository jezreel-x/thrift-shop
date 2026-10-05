import { formatPrice } from "../money";

/**
 * The order message "Order on WhatsApp" writes for the buyer.
 *
 * The shop already sells on WhatsApp; this saves the buyer typing "Hi, do you
 * have the khaki cargo pants in 32?" and saves the owner asking which ones.
 * The buyer still reads it and presses send. Nothing is reserved: the owner
 * confirms what is available in the chat, as they do today.
 */

export type WhatsAppLine = {
  title: string;
  swatch: string | null;
  size: string | null;
  quantity: number;
  /** One unit. */
  priceCents: number;
};

/** "Cargo Pants · Khaki · 32 × 2 — KSh 2,800" */
export function describeLine(line: WhatsAppLine): string {
  const what = [line.title, line.swatch, line.size].filter(Boolean).join(" · ");
  const howMany = line.quantity > 1 ? ` × ${line.quantity}` : "";

  return `${what}${howMany} — ${formatPrice(line.priceCents * line.quantity)}`;
}

/**
 * The whole message. One line reads as a sentence; several as a list with a
 * total. `link` is where the buyer saw it, so the owner can see the same thing.
 */
export function orderMessage(lines: WhatsAppLine[], link?: string): string {
  if (lines.length === 1) {
    return [`Hi, I'd like to order ${describeLine(lines[0])}.`, link].filter(Boolean).join("\n");
  }

  const total = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);

  return [
    "Hi, I'd like to order:",
    ...lines.map((line) => `• ${describeLine(line)}`),
    `Total: ${formatPrice(total)}`,
    link,
  ]
    .filter(Boolean)
    .join("\n");
}
