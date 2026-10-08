import { normalisePhone } from "../phone";

/**
 * The customer register's URL: what was searched, how it is sorted, which page.
 * Read as forgivingly as the other admin lists: anything unknown is the default.
 */

/**
 * How the admin chooses to order the list. Newest accounts first by default:
 * predictable, and the cheapest query. The other two rank by activity and are
 * worked out from orders only when chosen.
 */
export const CUSTOMER_SORTS = [
  { slug: "new", label: "Newest accounts" },
  { slug: "recent", label: "Recent buyers" },
  { slug: "spent", label: "Most spent" },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]["slug"];

export type CustomerQuery = { search: string; sort: CustomerSort; page: number };

type RawSearchParams = Record<string, string | string[] | undefined>;

const MAX_PAGE = 10_000;
const MAX_SEARCH = 100;

export function parseCustomerQuery(raw: RawSearchParams): CustomerQuery {
  const sort = first(raw.sort);
  const page = first(raw.page);

  return {
    search: (first(raw.q) ?? "").trim().slice(0, MAX_SEARCH),
    sort: CUSTOMER_SORTS.find((option) => option.slug === sort)?.slug ?? "new",
    // Digits only: Number() accepts "1e308".
    page: page && /^\d+$/.test(page) ? Math.min(Math.max(Number(page), 1), MAX_PAGE) : 1,
  };
}

export function customerListHref(query: Partial<CustomerQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.sort && query.sort !== "new") params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();

  return search ? `/admin/customers?${search}` : "/admin/customers";
}

/**
 * What a search box entry can match. People type a phone the way they read
 * it, "0712 345 678", but it is stored as 254712345678; a full number is
 * matched in its stored form, and anything else as text.
 */
export function searchTerms(search: string): { text: string; phone: string | null } {
  return { text: search, phone: normalisePhone(search) };
}

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
