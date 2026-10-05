import { MessageCircle } from "lucide-react";

import { whatsAppLink } from "@/lib/whatsapp";

/**
 * Opens the shop's WhatsApp with the order already written.
 *
 * A plain link: the buyer's own WhatsApp opens, they read the message and
 * press send. Nothing is reserved, so the hint says the shop confirms in the
 * chat — the way these shops already sell.
 */
export function OrderOnWhatsApp({
  number,
  message,
  label = "Order on WhatsApp",
}: {
  number: string;
  message: string;
  label?: string;
}) {
  return (
    <div>
      <a
        href={whatsAppLink(number, message)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-600 px-4 py-3 font-medium text-green-700 transition hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950"
      >
        <MessageCircle aria-hidden className="size-5" />
        {label}
      </a>
      <p className="mt-1.5 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Opens WhatsApp with your order written out. The shop confirms availability in the chat.
      </p>
    </div>
  );
}
