import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import type { CartLine } from "@/lib/shop/cart";
import { removeFromCartAction } from "@/lib/shop/cart-actions";
import { readCart } from "@/lib/shop/cart-session";
import { ProductCard } from "@/components/product-card";
import { QuantityStepper } from "@/components/quantity-stepper";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listSuggestions } from "@/lib/shop/suggestions";
import { OrderOnWhatsApp } from "@/components/order-on-whatsapp";
import { getShopWhatsApp } from "@/lib/shop/settings";
import { orderMessage } from "@/lib/shop/whatsapp-order";
import { formatPrice } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

/**
 * A cart holds nothing.
 *
 * Which is why this page has to be candid: an item may have sold, or be in
 * somebody else's checkout, since it was added. Saying so here — before the
 * buyer commits — is the whole reason each line carries a reason rather than
 * quietly vanishing.
 */
export default async function CartPage() {
  const cart = await readCart();
  const lines = cart?.lines ?? [];

  if (lines.length === 0) return <EmptyCart />;

  const unavailable = lines.filter((line) => !line.available);
  const [user, whatsapp] = await Promise.all([getCurrentUser(), getShopWhatsApp()]);
  // What can actually be had, in the quantities that can be had.
  const orderable = lines.filter((line) => line.available && line.quantityAvailable > 0);
  const suggestions = await listSuggestions({
    productIds: [...new Set(lines.map((line) => line.productId))],
    sizes: lines.flatMap((line) => (line.size ? [line.size] : [])),
    viewer: user?.id,
  });
  // Units that can be paid for: two of one shirt count as two pieces.
  const units = lines.reduce((sum, line) => sum + line.quantityAvailable, 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Nothing here is held for you until you check out.
      </p>

      <ul className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {lines.map((line) => (
          <CartRow key={line.variantId} line={line} />
        ))}
      </ul>

      <div className="mt-8 flex items-baseline justify-between">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {units} {units === 1 ? "piece" : "pieces"} available
        </span>
        <span className="text-xl font-semibold">{formatPrice(cart!.totalCents)}</span>
      </div>

      {unavailable.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {unavailable.length === 1 ? "One piece is" : `${unavailable.length} pieces are`} no longer
          available and {unavailable.length === 1 ? "has" : "have"} been left out of the total.
          Checkout will take the rest.
        </p>
      )}

      {cart!.availableCount > 0 ? (
        <Link
          href="/checkout"
          className="mt-6 block rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Check out
        </Link>
      ) : (
        <p className="mt-6 rounded-lg bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          Nothing in your cart is available to buy.
        </p>
      )}

      {whatsapp && orderable.length > 0 && (
        <div className="mt-3">
          <OrderOnWhatsApp
            number={whatsapp}
            label="Or order on WhatsApp"
            message={orderMessage(
              orderable.map((line) => ({
                title: line.title,
                swatch: line.swatch,
                size: line.size || null,
                quantity: line.quantityAvailable,
                priceCents: line.priceCents,
              })),
            )}
          />
        </div>
      )}

      <Link
        href="/"
        className="mt-6 block text-center text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        Keep looking
      </Link>

      {suggestions.length > 0 && (
        <section aria-labelledby="also-like" className="mt-16">
          <h2 id="also-like" className="text-lg font-semibold tracking-tight">
            You may also like
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {suggestions.map((product) => (
              // None of these are in the cart, so no stepper yet: Add to cart
              // brings the shopper back here with it added.
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function CartRow({ line }: { line: CartLine }) {
  return (
    <li className="flex gap-4 py-4">
      <Link href={`/products/${line.slug}`} className="shrink-0">
        {line.image ? (
          <Image
            src={line.image.url}
            alt={line.image.alt ?? line.title}
            width={line.image.width}
            height={line.image.height}
            sizes="80px"
            className={`aspect-3/4 w-20 rounded-lg bg-neutral-100 object-cover dark:bg-neutral-900 ${
              line.available ? "" : "opacity-50 grayscale"
            }`}
          />
        ) : (
          <div className="aspect-3/4 w-20 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/products/${line.slug}`} className="font-medium hover:underline">
          {line.title}
        </Link>
        <span className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          {[line.swatch, line.size].filter(Boolean).join(" · ")}
        </span>

        {!line.available && <UnavailableNote reason={line.reason} />}

        {line.available && line.quantityAvailable < line.quantity && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Only {line.quantityAvailable} left. Checkout will hold {line.quantityAvailable}, not{" "}
            {line.quantity}.
          </p>
        )}

        {line.available && (line.maxQuantity > 1 || line.quantity > 1) && (
          <div className="mt-2">
            <QuantityStepper
              variantId={line.variantId}
              quantity={line.quantity}
              max={line.maxQuantity}
              label={[line.title, line.swatch, line.size].filter(Boolean).join(", ")}
            />
          </div>
        )}

        <form action={removeFromCartAction} className="mt-auto pt-2">
          <input type="hidden" name="variantId" value={line.variantId} />
          <button
            type="submit"
            className="text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
          >
            Remove
          </button>
        </form>
      </div>

      <span
        className={`font-medium ${line.available ? "" : "text-neutral-400 line-through dark:text-neutral-600"}`}
      >
        {formatPrice(line.priceCents * (line.available ? line.quantityAvailable : line.quantity))}
      </span>
    </li>
  );
}

/**
 * Why a line cannot be bought.
 *
 * The distinction matters to the shopper: sold is final, held may lapse within
 * the quarter-hour and is worth waiting for.
 */
function UnavailableNote({ reason }: { reason: CartLine["reason"] }) {
  const message =
    reason === "sold"
      ? "Sold — this one is gone."
      : reason === "held"
        ? "Someone is checking out with this. It may come back shortly."
        : "No longer listed.";

  return <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{message}</p>;
}

function EmptyCart() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart is empty</h1>
      <p className="mt-3 text-sm text-pretty text-neutral-500 dark:text-neutral-400">
        Every piece is one of one, so a cart is a shortlist rather than a hold — worth filling while
        you decide.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Browse the rail
      </Link>
    </main>
  );
}
