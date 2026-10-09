import Link from "next/link";

import type { LimitReason } from "@/lib/shop/availability";
import { addToCartAction } from "@/lib/shop/cart-actions";
import { QuantityPicker } from "./quantity-picker";
import { QuantityStepper } from "./quantity-stepper";

/**
 * The control on a product page.
 *
 * Adding to a cart reserves nothing, so this is available to anyone, signed in
 * or not — asking for an account before somebody may even consider an item is
 * where people leave. The account is required later, at checkout, where there is
 * something real to hold.
 *
 * Before it's in the cart: − n + to choose how many, then Add to cart. After:
 * the same stepper as the cart and the catalogue cards, changing the cart
 * directly. Either way, when + stops, an amber note says why.
 */
export function AddToCart({
  variantId,
  maxQuantity,
  limitReason,
  inCartQuantity,
  needs,
  label,
}: {
  /** Null until the buyer has chosen everything the product needs. */
  variantId: string | null;
  /** What is free, within the shop's per-item limit. 0: none to be had. */
  maxQuantity: number;
  /** What sets `maxQuantity`: the shop's limit, or what's left. */
  limitReason: LimitReason;
  /** How many of this variant are already in the cart. */
  inCartQuantity: number;
  /** What to ask for when no variant is chosen yet, e.g. "a size". */
  needs?: string;
  /** What is being counted, for screen readers: "Cargo Pants, Green M". */
  label: string;
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
      <div className="flex flex-wrap items-start gap-3">
        <QuantityStepper
          variantId={variantId}
          quantity={inCartQuantity}
          // Never below what's already there, so − still works if stock fell.
          max={Math.max(inCartQuantity, maxQuantity)}
          label={label}
          limitReason={limitReason}
        />
        <Link
          href="/cart"
          className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {inCartQuantity > 1 ? `${inCartQuantity} in your cart` : "In your cart"} — view it
        </Link>
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
    <form action={addToCartAction} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="variantId" value={variantId} />
      {maxQuantity > 1 ? (
        <QuantityPicker max={maxQuantity} limitReason={limitReason} label={label} />
      ) : (
        <input type="hidden" name="quantity" value="1" />
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
