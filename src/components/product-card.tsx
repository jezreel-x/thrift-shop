import Image from "next/image";
import Link from "next/link";

import { ProductStatus } from "@/generated/prisma/enums";
import { CONDITION_LABELS } from "@/lib/catalogue";
import { formatPrice } from "@/lib/money";
import type { ProductCard as ProductCardData } from "@/lib/products";

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
}: {
  product: ProductCardData;
  priority?: boolean;
}) {
  const image = product.images[0];
  const isSold = product.status === ProductStatus.SOLD;
  const isReserved = product.status === ProductStatus.RESERVED;

  return (
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

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {product.brand ? `${product.brand} · ` : ""}
          {product.size} · {CONDITION_LABELS[product.condition]}
        </p>

        <p
          className={`text-sm font-semibold ${isSold ? "text-neutral-400 line-through dark:text-neutral-600" : ""}`}
        >
          {formatPrice(product.priceCents)}
        </p>
      </div>
    </Link>
  );
}
