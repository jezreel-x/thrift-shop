import Image from "next/image";
import Link from "next/link";

import { CONDITION_LABELS } from "@/lib/shop/catalogue";
import { formatPrice } from "@/lib/money";
import { addToCartAction } from "@/lib/shop/cart-actions";
import type { ProductCard as ProductCardData } from "@/lib/shop/products";
import { QuantityStepper } from "./quantity-stepper";

/**
 * One garment in the grid.
 *
 * Sold and reserved items stay in the catalogue rather than disappearing, so
 * the card has to say so unmistakably — in a one-of-one shop, "gone" is the
 * most important thing a card can communicate.
 */
export function ProductCard({
  product,
  priority,
  inCartQuantity = 0,
}: {
  product: ProductCardData;
  priority?: boolean;
  /** Units of this product's single variant already in the cart. */
  inCartQuantity?: number;
}) {
  const image = product.images[0];
  const isSold = product.availability === "SOLD";
  const isReserved = product.availability === "RESERVED";

  return (
    <div className="flex flex-col">
      <Link
        href={`/products/${product.slug}`}
        className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:focus-visible:ring-neutral-100"
      >
        <div className="relative aspect-3/4 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
          {image ? (
            <Image
              src={image.url}
              alt={image.alt ?? product.title}
              width={image.width}
              height={image.height}
              // Two columns on a phone, up to four on a wide screen. Without this
              // the browser assumes full width and downloads an image four times
              // larger than the slot it lands in.
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              // The first row is the largest contentful paint on this page.
              priority={priority}
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${
                isSold ? "opacity-60 grayscale" : ""
              }`}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
              No photo
            </div>
          )}

          {(isSold || isReserved) && (
            <span
              className={`absolute top-2 left-2 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide uppercase ${
                isSold ? "bg-neutral-900 text-white" : "bg-amber-500 text-neutral-950"
              }`}
            >
              {isSold ? "Sold" : "Reserved"}
            </span>
          )}
        </div>

        <div className="mt-3 space-y-1">
          <h2 className="text-sm leading-snug font-medium text-balance">{product.title}</h2>

          {product.swatches.length > 1 && (
            <p
              className="flex items-center gap-1"
              aria-label={`${product.swatches.length} colours`}
            >
              {product.swatches.slice(0, 6).map((swatch) => (
                <span
                  key={swatch.name}
                  title={swatch.name}
                  className="size-3 rounded-full border border-black/10 bg-neutral-300 dark:border-white/20"
                  style={swatch.hex ? { backgroundColor: swatch.hex } : undefined}
                />
              ))}
            </p>
          )}

          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {product.brand ? `${product.brand} · ` : ""}
            {[
              product.sizes.join(", "),
              product.condition && product.categoryRef?.showCondition !== false
                ? CONDITION_LABELS[product.condition]
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <p
            className={`text-sm font-semibold ${isSold ? "text-neutral-400 line-through dark:text-neutral-600" : ""}`}
          >
            {product.priceVaries ? "From " : ""}
            {formatPrice(product.fromPriceCents)}
          </p>
        </div>
      </Link>

      <CardAction product={product} inCartQuantity={inCartQuantity} />
    </div>
  );
}

/**
 * Buying from the grid. Outside the card's link, because a form cannot sit
 * inside one.
 *
 * Nothing to choose (one variant, as every thrift item has): add it here, then
 * a − n + stepper. Something to choose: a link to the page, where the colour
 * and size are picked. Nothing for sold or held pieces — the badge says why.
 */
function CardAction({
  product,
  inCartQuantity,
}: {
  product: ProductCardData;
  inCartQuantity: number;
}) {
  if (product.availability !== "AVAILABLE") return null;

  if (!product.quickAdd) {
    return (
      <Link
        href={`/products/${product.slug}`}
        className="mt-2 rounded-lg border border-neutral-300 px-3 py-2 text-center text-sm font-medium transition hover:border-neutral-500 dark:border-neutral-700"
      >
        Choose options
      </Link>
    );
  }

  if (inCartQuantity > 0) {
    return (
      <div className="mt-2 flex items-start justify-between gap-2">
        <span className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">In your cart</span>
        <QuantityStepper
          variantId={product.quickAdd.variantId}
          quantity={inCartQuantity}
          max={Math.max(inCartQuantity, product.quickAdd.maxQuantity)}
          label={product.title}
          size="sm"
          limitReason={product.quickAdd.limitReason}
        />
      </div>
    );
  }

  return (
    <form action={addToCartAction} className="mt-2">
      <input type="hidden" name="variantId" value={product.quickAdd.variantId} />
      <button
        type="submit"
        className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Add to cart
      </button>
    </form>
  );
}
