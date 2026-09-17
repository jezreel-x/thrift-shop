import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pagination } from "@/components/pagination";
import { ProductCard } from "@/components/product-card";
import { ProductFilters } from "@/components/product-filters";
import {
  buildProductQuery,
  hasActiveFilters,
  parseProductQuery,
} from "@/lib/product-search-params";
import type { ProductQuery } from "@/lib/product-search-params";
import { listProducts } from "@/lib/products";

/**
 * Built per request rather than declared statically, because the canonical URL
 * depends on the filters.
 *
 * Submitting the filter form leaves empty fields in the query string, so one
 * page is reachable as `/`, `/?q=&min=&max=&sort=newest` and every combination
 * in between. Rebuilding the address from the parsed query collapses all of
 * them onto a single canonical URL, so a page's search ranking is not divided
 * between a dozen spellings of itself.
 */
export async function generateMetadata({ searchParams }: PageProps<"/">): Promise<Metadata> {
  const query = parseProductQuery(await searchParams);

  return {
    title: "Secondhand fashion in Nairobi",
    description:
      "Handpicked secondhand hoodies, sweatshirts, tees, flannels and pants in Nairobi. " +
      "Every piece is one of one — when it is gone, it is gone.",
    alternates: { canonical: buildProductQuery(query) },
    // TODO: remove once the catalogue carries the shop's own photography rather
    // than placeholders. Nothing here should be indexed until then.
    robots: { index: false, follow: false },
  };
}

export default async function CataloguePage({ searchParams }: PageProps<"/">) {
  const query = parseProductQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <p className="font-mono text-xs tracking-widest text-neutral-500 uppercase">Nairobi</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The Thrift Plug</h1>
        <p className="mt-3 max-w-prose text-pretty text-neutral-600 dark:text-neutral-400">
          Handpicked secondhand fashion. Every piece is one of one — when it is gone, it is gone.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-10">
        <aside className="mb-6 lg:mb-0">
          <ProductFilters query={query} />
        </aside>

        {/*
          The grid is the only part that touches the database, so it streams
          behind a fallback while the shell — header, filters, the filters the
          visitor already chose — renders immediately.
        */}
        <Suspense key={buildProductQuery(query)} fallback={<ResultsSkeleton />}>
          <Results query={query} />
        </Suspense>
      </div>
    </main>
  );
}

async function Results({ query }: { query: ProductQuery }) {
  const { items, total, pageCount } = await listProducts(query);

  if (items.length === 0) return <EmptyState query={query} />;

  return (
    <section aria-label="Products">
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {total} {total === 1 ? "piece" : "pieces"}
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((product, index) => (
          // The first row is this page's largest contentful paint; the rest can
          // wait until they are scrolled towards.
          <ProductCard key={product.id} product={product} priority={index < 4} />
        ))}
      </div>

      <Pagination query={query} pageCount={pageCount} />
    </section>
  );
}

function EmptyState({ query }: { query: ProductQuery }) {
  const filtered = hasActiveFilters(query.filters);

  return (
    <section className="rounded-lg border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
      <p className="font-medium">{filtered ? "Nothing matches that" : "The rail is empty"}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-pretty text-neutral-500 dark:text-neutral-400">
        {filtered
          ? "Stock is one of one, so narrow searches come up empty often. Try fewer filters."
          : "New pieces are added regularly. Check back shortly."}
      </p>

      {filtered && (
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Clear filters
        </Link>
      )}
    </section>
  );
}

/** Mirrors the grid's shape so the page does not jump when results arrive. */
function ResultsSkeleton() {
  return (
    <section aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="animate-pulse">
          <div className="aspect-3/4 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
          <div className="mt-3 h-3 w-3/4 rounded bg-neutral-100 dark:bg-neutral-900" />
          <div className="mt-2 h-3 w-1/2 rounded bg-neutral-100 dark:bg-neutral-900" />
        </div>
      ))}
    </section>
  );
}
