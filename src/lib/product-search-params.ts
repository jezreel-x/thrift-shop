import { Category, Condition, Gender } from "@/generated/prisma/enums";
import { allSizes } from "./catalogue";
import type { ProductFilters, ProductSort } from "./products";

/**
 * Translates between the catalogue's URL and the options `listProducts` takes.
 *
 * Filters live in the query string rather than in client state so a filtered
 * view is a real page: linkable, shareable over WhatsApp, surviving a refresh,
 * and visible to a search engine. That is most of the reason this project uses
 * a server-rendered framework at all.
 *
 * Everything here is deliberately forgiving. A query string is arbitrary text —
 * typed, pasted, mangled in a chat app, guessed by a crawler — so an
 * unrecognised value is dropped rather than rejected. A bad link must show the
 * catalogue, never an error page, because bad links are normal.
 */

export const SORTS = ["newest", "price-asc", "price-desc"] as const;

export const SORT_LABELS: Record<ProductSort, string> = {
  newest: "Newest first",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

/** Query-string keys, named once so the page and the filter form cannot drift. */
export const PARAM = {
  size: "size",
  category: "category",
  condition: "condition",
  gender: "gender",
  min: "min",
  max: "max",
  search: "q",
  sort: "sort",
  page: "page",
} as const;

/** The shape Next.js hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export type ProductQuery = {
  filters: ProductFilters;
  sort: ProductSort;
  page: number;
};

/**
 * Prices appear in the URL as whole shillings — `?min=500&max=2000` — while
 * everything inside the application works in integer cents. URLs are read and
 * hand-edited by people, and `min=50000` reads like a fifty-thousand-shilling
 * hoodie.
 */
const CENTS_PER_SHILLING = 100;

export function parseProductQuery(raw: RawSearchParams): ProductQuery {
  const sizes = validValues(raw[PARAM.size], new Set(allSizes()));
  const categories = validValues(raw[PARAM.category], new Set<string>(Object.values(Category)));
  const conditions = validValues(raw[PARAM.condition], new Set<string>(Object.values(Condition)));
  const genders = validValues(raw[PARAM.gender], new Set<string>(Object.values(Gender)));

  const search = first(raw[PARAM.search])?.trim();
  const minPriceCents = shillingsToCents(first(raw[PARAM.min]));
  const maxPriceCents = shillingsToCents(first(raw[PARAM.max]));

  const filters: ProductFilters = {};
  if (sizes.length) filters.sizes = sizes;
  if (categories.length) filters.categories = categories as Category[];
  if (conditions.length) filters.conditions = conditions as Condition[];
  if (genders.length) filters.genders = genders as Gender[];
  if (search) filters.search = search;

  // A range given backwards is a slider dragged past itself, not an attack.
  // Swapping gives the visitor what they meant; an empty grid is merely correct.
  if (minPriceCents !== undefined && maxPriceCents !== undefined && minPriceCents > maxPriceCents) {
    filters.minPriceCents = maxPriceCents;
    filters.maxPriceCents = minPriceCents;
  } else {
    if (minPriceCents !== undefined) filters.minPriceCents = minPriceCents;
    if (maxPriceCents !== undefined) filters.maxPriceCents = maxPriceCents;
  }

  return {
    filters,
    sort: parseSort(first(raw[PARAM.sort])),
    page: parsePage(first(raw[PARAM.page])),
  };
}

/**
 * Renders a query back into a URL, for every link that changes the view —
 * a page number, a sort option, clearing a filter.
 *
 * Defaults are omitted rather than spelled out, so the unfiltered catalogue is
 * `/` and never `/?sort=newest&page=1`. Two URLs serving one page split its
 * search ranking between them, and make "clear filters" look like it did
 * nothing at all.
 */
export function buildProductQuery({ filters, sort, page }: Partial<ProductQuery>): string {
  const params = new URLSearchParams();

  for (const size of filters?.sizes ?? []) params.append(PARAM.size, size);
  for (const category of filters?.categories ?? []) params.append(PARAM.category, category);
  for (const condition of filters?.conditions ?? []) params.append(PARAM.condition, condition);
  for (const gender of filters?.genders ?? []) params.append(PARAM.gender, gender);

  if (filters?.minPriceCents !== undefined) {
    params.set(PARAM.min, String(filters.minPriceCents / CENTS_PER_SHILLING));
  }
  if (filters?.maxPriceCents !== undefined) {
    params.set(PARAM.max, String(filters.maxPriceCents / CENTS_PER_SHILLING));
  }
  if (filters?.search) params.set(PARAM.search, filters.search);
  if (sort && sort !== "newest") params.set(PARAM.sort, sort);
  if (page !== undefined && page > 1) params.set(PARAM.page, String(page));

  const query = params.toString();

  return query ? `?${query}` : "/";
}

/** True when anything is narrowing the catalogue. Drives the "clear" affordance. */
export function hasActiveFilters(filters: ProductFilters): boolean {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
}

/**
 * Keeps only values the application recognises, de-duplicated.
 *
 * This matters for more than tidiness. `size` ends up in a SQL `IN` clause, and
 * drawing the allow-list from the schema's own enums means nothing that is not
 * already a legal value can reach the database.
 */
function validValues(raw: string | string[] | undefined, allowed: Set<string>): string[] {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  return [...new Set(values.filter((value) => allowed.has(value)))];
}

/** A repeated key arrives as an array; for single-valued params, take the first. */
function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function shillingsToCents(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const shillings = Number(raw);

  // A negative bound is nonsense rather than a narrower filter, so the
  // catalogue is simply left unbounded on that side.
  if (!Number.isFinite(shillings) || shillings < 0) return undefined;

  return Math.round(shillings * CENTS_PER_SHILLING);
}

function parseSort(raw: string | undefined): ProductSort {
  return SORTS.includes(raw as ProductSort) ? (raw as ProductSort) : "newest";
}

/**
 * Far beyond any catalogue this shop will hold, and small enough that the
 * OFFSET it implies stays trivial for Postgres.
 */
const MAX_PAGE = 10_000;

function parsePage(raw: string | undefined): number {
  // Digits only, rather than trusting Number(): it reads "1e308" as a perfectly
  // good integer, which would reach the database as an OFFSET large enough to
  // fail the query. Anything else — zero, negative, fractional, words — is
  // page one.
  if (raw === undefined || !/^\d+$/.test(raw)) return 1;

  const page = Number(raw);
  if (page < 1) return 1;

  // Past the cap, show the last plausible page rather than silently bouncing
  // back to the first: an empty page is the honest answer to a page that far
  // out, and listProducts already returns one.
  return Math.min(page, MAX_PAGE);
}
