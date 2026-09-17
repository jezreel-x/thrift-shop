import Link from "next/link";

import { buildProductQuery } from "@/lib/product-search-params";
import type { ProductQuery } from "@/lib/product-search-params";

/**
 * Numbered pages rather than infinite scroll.
 *
 * Every page is a URL a crawler can reach and a person can share, which infinite
 * scroll hides entirely — and on metered mobile data, loading what you asked for
 * beats loading forever as you scroll.
 */
export function Pagination({ query, pageCount }: { query: ProductQuery; pageCount: number }) {
  if (pageCount <= 1) return null;

  const { page } = query;
  const href = (target: number) => buildProductQuery({ ...query, page: target });

  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1">
      <Step href={href(page - 1)} disabled={page <= 1} label="Previous">
        ←
      </Step>

      {pagesToShow(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          <span key={`gap-${index}`} aria-hidden className="px-2 text-neutral-400">
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={href(entry)}
            aria-label={`Page ${entry}`}
            aria-current={entry === page ? "page" : undefined}
            className={`min-w-10 rounded-lg px-3 py-2 text-center text-sm transition ${
              entry === page
                ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            {entry}
          </Link>
        ),
      )}

      <Step href={href(page + 1)} disabled={page >= pageCount} label="Next">
        →
      </Step>
    </nav>
  );
}

function Step({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  // A disabled step is a span, not a greyed-out link: there is no page to go to,
  // so there should be nothing for a keyboard or a crawler to follow.
  if (disabled) {
    return (
      <span
        aria-hidden
        className="min-w-10 px-3 py-2 text-center text-sm text-neutral-300 dark:text-neutral-700"
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="min-w-10 rounded-lg px-3 py-2 text-center text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-900"
    >
      {children}
    </Link>
  );
}

/**
 * First page, last page, the current one and its neighbours — with gaps for the
 * rest, so a hundred-page catalogue does not render a hundred links.
 */
export function pagesToShow(page: number, pageCount: number): (number | "gap")[] {
  const window = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const pages = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  return pages.flatMap((n, index) => {
    const previous = pages[index - 1];

    return previous !== undefined && n - previous > 1 ? ["gap" as const, n] : [n];
  });
}
