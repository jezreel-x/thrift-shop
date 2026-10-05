import { Minus, Plus } from "lucide-react";

import { setCartQuantityAction } from "@/lib/shop/cart-actions";

/**
 * − n + for one cart line, in the cart and on catalogue cards.
 *
 * Each button is its own tiny form posting the new quantity, so it works with
 * no JavaScript (a page reload) and needs no client state. + stops at what is
 * free; − at one removes the line.
 */
export function QuantityStepper({
  variantId,
  quantity,
  max,
  label,
  size = "md",
}: {
  variantId: string;
  quantity: number;
  /** What is free, capped per line. */
  max: number;
  /** For screen readers: what is being counted, e.g. "Cargo Pants, Khaki 32". */
  label: string;
  size?: "sm" | "md";
}) {
  const button =
    size === "sm"
      ? "flex size-8 items-center justify-center rounded-full"
      : "flex size-9 items-center justify-center rounded-full";

  return (
    <div
      role="group"
      aria-label={`Quantity of ${label}`}
      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 p-0.5 dark:border-neutral-700"
    >
      <form action={setCartQuantityAction}>
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="quantity" value={quantity - 1} />
        <button
          type="submit"
          aria-label={quantity <= 1 ? `Remove ${label}` : `One fewer ${label}`}
          className={`${button} transition hover:bg-neutral-100 dark:hover:bg-neutral-800`}
        >
          <Minus aria-hidden className="size-4" />
        </button>
      </form>
      <span aria-live="polite" className="min-w-6 text-center text-sm font-medium tabular-nums">
        {quantity}
      </span>
      <form action={setCartQuantityAction}>
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="quantity" value={quantity + 1} />
        <button
          type="submit"
          disabled={quantity >= max}
          aria-label={quantity >= max ? `No more ${label} available` : `One more ${label}`}
          className={`${button} transition hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-neutral-800`}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </form>
    </div>
  );
}
