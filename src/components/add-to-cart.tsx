import Link from "next/link";

import { MAX_PER_LINE } from "@/lib/shop/availability";
import { addToCartAction, removeFromCartAction } from "@/lib/shop/cart-actions";

/**
 * The control on a product page.
 *
 * Adding to a cart reserves nothing, so this is available to anyone, signed in
 * or not — asking for an account before somebody may even consider an item is
 * where people leave. The account is required later, at checkout, where there is
 * something real to hold.
 *
 * An ordinary form: the quantity is a <select>, so it works without JavaScript.
 */
export function AddToCart({
  variantId,
  maxQuantity,
  inCartQuantity,
  needs,
}: {
  /** Null until the buyer has chosen everything the product needs. */
  variantId: string | null;
  /** What is free, capped per line. 0: none to be had. */
  maxQuantity: number;
  /** How many of this variant are already in the cart. */
  inCartQuantity: number;
  /** What to ask for when no variant is chosen yet, e.g. "a size". */
  needs?: string;
}) {
  if (!variantId) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Choose {needs ?? "an option"} to add it to your cart
      </p>
    );
  }

  if (inCartQuantity > 0) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/cart"
          className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {inCartQuantity > 1 ? `${inCartQuantity} in your cart` : "In your cart"} — view it
        </Link>
        <form action={removeFromCartAction}>
          <input type="hidden" name="variantId" value={variantId} />
          <button
            type="submit"
            className="rounded-lg px-3 py-3 text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
          >
            Remove
          </button>
        </form>
      </div>
    );
  }

  if (maxQuantity <= 0) {
    return (
      <p className="rounded-lg bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        Not available
      </p>
    );
  }

  return (
    <form action={addToCartAction} className="flex items-stretch gap-3">
      <input type="hidden" name="variantId" value={variantId} />
      {maxQuantity > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Quantity</span>
          <select
            name="quantity"
            defaultValue="1"
            aria-label="Quantity"
            className="h-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700"
          >
            {Array.from({ length: Math.min(maxQuantity, MAX_PER_LINE) }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Add to cart
      </button>
    </form>
  );
}
