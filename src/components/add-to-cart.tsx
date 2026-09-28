import Link from "next/link";

import { addToCartAction, removeFromCartAction } from "@/lib/cart-actions";

/**
 * The control on a product page.
 *
 * Adding to a cart reserves nothing, so this is available to anyone, signed in
 * or not — asking for an account before somebody may even consider an item is
 * where people leave. The account is required later, at checkout, where there is
 * something real to hold.
 */
export function AddToCart({
  productId,
  inCart,
  disabled,
}: {
  productId: string;
  inCart: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <p className="rounded-lg bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        Not available
      </p>
    );
  }

  if (inCart) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/cart"
          className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          In your cart — view it
        </Link>
        <form action={removeFromCartAction}>
          <input type="hidden" name="productId" value={productId} />
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

  return (
    <form action={addToCartAction}>
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Add to cart
      </button>
    </form>
  );
}
