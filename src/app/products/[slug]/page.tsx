import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductGallery } from "@/components/product-gallery";
import { ProductStatus } from "@/generated/prisma/enums";
import { CATEGORY_LABELS, CONDITION_LABELS, GENDER_LABELS } from "@/lib/catalogue";
import { formatPrice } from "@/lib/money";
import { buildProductQuery } from "@/lib/product-search-params";
import { getProductBySlug } from "@/lib/products";

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
    `${CONDITION_LABELS[product.condition]} condition, size ${product.size}. ` +
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

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const isSold = product.status === ProductStatus.SOLD;
  const isReserved = product.status === ProductStatus.RESERVED;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <Link
        href="/"
        className="inline-block text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        ← All pieces
      </Link>

      <div className="mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-12">
        <ProductGallery images={product.images} title={product.title} />

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
            {formatPrice(product.priceCents)}
          </p>

          {product.description && (
            <p className="mt-6 text-pretty text-neutral-600 dark:text-neutral-400">
              {product.description}
            </p>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-neutral-200 pt-6 text-sm dark:border-neutral-800">
            <Fact label="Size" value={product.size} />
            <Fact label="Condition" value={CONDITION_LABELS[product.condition]} />
            <Fact label="Category" value={CATEGORY_LABELS[product.category]} />
            <Fact label="Fit" value={GENDER_LABELS[product.gender]} />
            {product.brand && <Fact label="Brand" value={product.brand} />}
          </dl>

          <div className="mt-8 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            {isSold ? (
              <p className="text-neutral-600 dark:text-neutral-400">
                This piece has sold. Every item here is one of one, so it will not be restocked —
                but{" "}
                <Link
                  href={buildProductQuery({ filters: { categories: [product.category] } })}
                  className="underline underline-offset-4"
                >
                  similar {CATEGORY_LABELS[product.category].toLowerCase()}
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
                Available. Checkout opens soon — reserving and paying by M-Pesa arrives in the next
                release.
              </p>
            )}
          </div>
        </div>
      </div>

      <ProductStructuredData product={product} />
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
}: {
  product: NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    image: product.images.map((image) => image.url),
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    size: product.size,
    itemCondition:
      product.condition === "NEW_WITH_TAGS"
        ? "https://schema.org/NewCondition"
        : "https://schema.org/UsedCondition",
    offers: {
      "@type": "Offer",
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: "KES",
      availability:
        product.status === ProductStatus.AVAILABLE
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
