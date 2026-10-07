/**
 * The admin product list's URL: what was searched, which category, whether
 * withdrawn products are shown, and which page.
 *
 * Read as forgivingly as the order queue's: anything unknown is the default.
 */

export type ProductQuery = {
  search: string;
  /** A category slug; empty for every category. */
  category: string;
  withdrawn: boolean;
  page: number;
};

type RawSearchParams = Record<string, string | string[] | undefined>;

const MAX_PAGE = 10_000;
const MAX_SEARCH = 100;

export function parseProductQuery(raw: RawSearchParams, categorySlugs: string[]): ProductQuery {
  const category = first(raw.category) ?? "";
  const page = first(raw.page);

  return {
    search: (first(raw.q) ?? "").trim().slice(0, MAX_SEARCH),
    category: categorySlugs.includes(category) ? category : "",
    withdrawn: first(raw.show) === "withdrawn",
    // Digits only: Number() accepts "1e308".
    page: page && /^\d+$/.test(page) ? Math.min(Math.max(Number(page), 1), MAX_PAGE) : 1,
  };
}

/** The address of a view of the list, defaults left out. */
export function productListHref(query: Partial<ProductQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.category) params.set("category", query.category);
  if (query.withdrawn) params.set("show", "withdrawn");
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();

  return search ? `/admin/products?${search}` : "/admin/products";
}

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
