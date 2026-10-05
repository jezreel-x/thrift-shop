import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToCart } from "@/components/add-to-cart";
import { ProductGallery } from "@/components/product-gallery";
import { CONDITION_LABELS, GENDER_LABELS } from "@/lib/shop/catalogue";
import { formatPrice } from "@/lib/money";
import { readCart } from "@/lib/shop/cart-session";
import { buildProductQuery } from "@/lib/shop/product-search-params";
import { getProductBySlug } from "@/lib/shop/products";
import { type Selection, resolveChoice } from "@/lib/shop/variant-choice";
import { VariantPicker } from "@/components/variant-picker";
import { OrderOnWhatsApp } from "@/components/order-on-whatsapp";
import { getShopWhatsApp } from "@/lib/shop/settings";
import { siteUrl } from "@/lib/site";
import { orderMessage } from "@/lib/shop/whatsapp-order";

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  // A missing product still needs metadata — this runs before the page body,
  // and throwing here would produce a server error instead of a 404.
  if (!product) return { title: "Not found" };

  const description =
    product.description ??
    `${product.condition ? `${CONDITION_LABELS[product.condition]} condition` : product.title}` +
      `${product.variants[0]?.option2 ? `, size ${product.variants[0].option2}` : ""}. ` +
      `${formatPrice(product.priceCents)}. One of one — when it is gone, it is gone.`;

  const image = product.images[0];

  return {
    title: product.title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    // The shop is WhatsApp-native, so a pasted link unfurling with the garment
    // and its price is a real part of how anything sells here.
    openGraph: {
      type: "website",
      title: product.title,
      description,
      images: image ? [{ url: image.url, width: image.width, height: image.height }] : undefined,
    },
    // TODO: remove alongside the catalogue's own noindex, once the shop's
    // photography replaces the placeholders.
    robots: { index: false, follow: false },
  };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const isSold = product.availability === "SOLD";
  const isReserved = product.availability === "RESERVED";

  // What the buyer has picked, from the URL.
  const raw = await searchParams;
  const pick = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  const selection: Selection = { option1: pick(raw.option1), option2: pick(raw.option2) };

  const choice = resolveChoice({
    variants: product.variants,
    swatches: product.swatches,
    option2Order: product.categoryRef?.option2Values ?? [],
    basePriceCents: product.priceCents,
    selection,
  });
  const selectedSwatch = choice.swatches.find((swatch) => swatch.selected);
  const hasChoices = choice.swatches.length > 0 || choice.option2.length > 1;
  const variant = choice.variant;
  // "Only N left" for shop stock. A thrift item is always the last one, and the
  // page already says it is one of one.
  const fewLeft =
    variant &&
    choice.free > 0 &&
    choice.free <= 3 &&
    (variant.stock > 1 || product.variants.length > 1)
      ? choice.free
      : null;

  // Photos of the chosen colour, plus those of every colour; all of them when
  // the colour has none of its own.
  const ofSwatch = product.images.filter(
    (image) => image.swatchId === null || image.swatchId === selectedSwatch?.id,
  );
  const images = ofSwatch.length > 0 ? ofSwatch : product.images;

  const [cart, whatsapp] = await Promise.all([readCart(), getShopWhatsApp()]);
  const inCartQuantity = cart?.lines.find((line) => line.variantId === variant?.id)?.quantity ?? 0;
  const option2Name = product.categoryRef?.option2Name ?? "Size";
  const needs =
    choice.needs === "option1"
      ? `a ${(product.categoryRef?.option1Name ?? "colour").toLowerCase()}`
      : `a ${option2Name.toLowerCase()}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <Link
        href="/"
        className="inline-block text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        ← All pieces
      </Link>

      <div className="mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-12">
        <ProductGallery images={images} title={product.title} />

        <div className="mt-8 lg:mt-0">
          {(isSold || isReserved) && (
            <p
              className={`mb-4 inline-block rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase ${
                isSold ? "bg-neutral-900 text-white" : "bg-amber-500 text-neutral-950"
              }`}
            >
              {isSold ? "Sold" : "Reserved"}
            </p>
          )}

          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {product.title}
          </h1>

          <p
            className={`mt-3 text-2xl font-semibold ${
              isSold ? "text-neutral-400 line-through dark:text-neutral-600" : ""
            }`}
          >
            {choice.priceIsFrom ? "From " : ""}
            {formatPrice(choice.priceCents)}
          </p>

          {hasChoices && (
            <VariantPicker
              pathname={`/products/${product.slug}`}
              choice={choice}
              option1Name={product.categoryRef?.option1Name ?? null}
              option2Name={product.categoryRef?.option2Name ?? null}
            />
          )}

          {fewLeft !== null && (
            <p className="mt-4 text-sm font-medium text-amber-700 dark:text-amber-400">
              Only {fewLeft} left
              {variant?.option2 && choice.option2.length > 1 ? ` in ${variant.option2}` : ""}
            </p>
          )}

          {product.description && (
            <p className="mt-6 text-pretty text-neutral-600 dark:text-neutral-400">
              {product.description}
            </p>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-neutral-200 pt-6 text-sm dark:border-neutral-800">
            {!hasChoices && variant?.option2 && (
              <Fact label={option2Name} value={variant.option2} />
            )}
            {product.condition && product.categoryRef?.showCondition !== false && (
              <Fact label="Condition" value={CONDITION_LABELS[product.condition]} />
            )}
            {product.categoryRef && <Fact label="Category" value={product.categoryRef.name} />}
            {product.gender && product.categoryRef?.showFit !== false && (
              <Fact label="Fit" value={GENDER_LABELS[product.gender]} />
            )}
            {product.brand && <Fact label="Brand" value={product.brand} />}
          </dl>

          <div className="mt-8 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            {isSold ? (
              <p className="text-neutral-600 dark:text-neutral-400">
                This piece has sold. Every item here is one of one, so it will not be restocked —
                but{" "}
                <Link
                  href={buildProductQuery({
                    filters: product.categoryRef ? { categories: [product.categoryRef.slug] } : {},
                  })}
                  className="underline underline-offset-4"
                >
                  similar {(product.categoryRef?.name ?? "pieces").toLowerCase()}
                </Link>{" "}
                may be available.
              </p>
            ) : isReserved ? (
              <p className="text-neutral-600 dark:text-neutral-400">
                Someone is checking out with this piece. If they do not complete payment it returns
                to the rail shortly.
              </p>
            ) : (
              <p className="text-neutral-600 dark:text-neutral-400">
                Available. A cart holds nothing — the piece is yours once you reach checkout.
              </p>
            )}
          </div>

          <div className="mt-6">
            <AddToCart
              variantId={variant?.id ?? null}
              maxQuantity={variant ? Math.min(choice.free, 5) : 0}
              inCartQuantity={inCartQuantity}
              needs={needs}
            />
            {/* Once there is something specific to ask for, and something to be had. */}
            {whatsapp && variant && choice.free > 0 && (
              <div className="mt-3">
                <OrderOnWhatsApp
                  number={whatsapp}
                  message={orderMessage(
                    [
                      {
                        title: product.title,
                        swatch: selectedSwatch?.name ?? null,
                        size: variant.option2,
                        quantity: 1,
                        priceCents: choice.priceCents,
                      },
                    ],
                    new URL(
                      `/products/${product.slug}?${new URLSearchParams({
                        ...(selectedSwatch ? { option1: selectedSwatch.slug } : {}),
                        ...(variant.option2 ? { option2: variant.option2 } : {}),
                      })}`,
                      siteUrl,
                    ).toString(),
                  )}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <ProductStructuredData product={product} priceCents={choice.priceCents} />
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

/**
 * Schema.org Product data, for search results and link previews.
 *
 * `availability` is the part that earns its place: it lets a search engine show
 * a piece as sold rather than sending someone to a page for something they
 * cannot buy — which, in a shop where everything is one of one, would otherwise
 * be most of the catalogue before long.
 */
function ProductStructuredData({
  product,
  priceCents,
}: {
  product: NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;
  /** The chosen variant price, or the "From" price. */
  priceCents: number;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    image: product.images.map((image) => image.url),
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    size: product.variants[0]?.option2 ?? undefined,
    itemCondition:
      product.condition === "NEW_WITH_TAGS"
        ? "https://schema.org/NewCondition"
        : "https://schema.org/UsedCondition",
    offers: {
      "@type": "Offer",
      price: (priceCents / 100).toFixed(2),
      priceCurrency: "KES",
      availability:
        product.availability === "AVAILABLE"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
    },
  };

  return (
    <script
      type="application/ld+json"
      // Values come from our own database, and JSON.stringify escapes them; the
      // remaining risk is a literal "</script>" inside a description ending the
      // block early, which replacing the angle bracket prevents.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
