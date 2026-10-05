import type { Condition, Gender } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import {
  AVAILABILITY_RANK,
  type ProductAvailability,
  type VariantAvailability,
  freeUnits,
  maxQuantity,
  productAvailability,
} from "./availability";
import { effectivePrice, priceSummary } from "./variant-choice";
import { getAvailability } from "./reservations";

/**
 * Catalogue queries.
 *
 * Everything here filters on `deletedAt: null`. A soft-deleted product is
 * invisible to buyers but must stay on the orders that sold it, so "deleted"
 * can never mean "gone from the table".
 */

/** Items per page. Small enough to stay cheap on a phone over mobile data. */
export const PAGE_SIZE = 24;

export type ProductSort = "newest" | "price-asc" | "price-desc";

export type ProductFilters = {
  sizes?: string[];
  /** Category slugs. */
  categories?: string[];
  conditions?: Condition[];
  genders?: Gender[];
  minPriceCents?: number;
  maxPriceCents?: number;
  /** Matched against title, brand and description. */
  search?: string;
};

export type ListProductsOptions = {
  filters?: ProductFilters;
  sort?: ProductSort;
  /** 1-based, as it appears in the URL. */
  page?: number;
};

/** The fields a catalogue card needs, and no more. */
const cardSelect = {
  id: true,
  slug: true,
  title: true,
  brand: true,
  priceCents: true,
  condition: true,
  gender: true,
  createdAt: true,
  categoryRef: { select: { slug: true, name: true, showCondition: true } },
  variants: { select: { id: true, option2: true }, orderBy: { createdAt: "asc" } },
  swatches: { select: { name: true, hex: true }, orderBy: { position: "asc" } },
  images: {
    select: { url: true, alt: true, width: true, height: true },
    orderBy: { position: "asc" },
    // Only the thumbnail. Fetching every image for every card would multiply the
    // rows returned by a listing page by five for nothing anyone can see.
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export type ProductCard = Prisma.ProductGetPayload<{ select: typeof cardSelect }> & {
  /** From its variants' stock and live holds. */
  availability: ProductAvailability;
  /** Every option-2 value the product comes in, for the card's subtitle. */
  sizes: string[];
  /** The lowest price among what can still be bought — the card's figure. */
  fromPriceCents: number;
  /** Variants differ in price, so the card says "From". */
  priceVaries: boolean;
  /**
   * The one variant, when there is nothing to choose: the card can add it to a
   * cart directly. Null when the buyer must pick a colour or size first.
   */
  quickAdd: { variantId: string; maxQuantity: number } | null;
};

export type ProductListPage = {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of the catalogue, filtered and sorted.
 *
 * Sold and reserved items are included rather than hidden: a sold item still
 * earns its search traffic, and a grid where things visibly sell is a more
 * honest picture of a one-of-one shop than one where they quietly vanish. They
 * are always ranked below available stock — see {@link orderFor}.
 */
export async function listProducts({
  filters = {},
  sort = "newest",
  page = 1,
}: ListProductsOptions = {}): Promise<ProductListPage> {
  const where = whereFor(filters);
  const currentPage = Math.max(1, Math.trunc(page));

  // Availability leads the sort, and it is computed — stock minus live holds —
  // so the database cannot order by it. Every match is ranked here, then one
  // page is fetched. Cheap at a few hundred products. At tens of thousands the
  // upgrade is a SQL query that ranks in the database, joining holds.
  const candidates = await prisma.product.findMany({
    where,
    select: {
      id: true,
      priceCents: true,
      createdAt: true,
      variants: { select: { id: true, priceCents: true } },
    },
  });

  const availability = await getAvailability(
    candidates.flatMap((product) => product.variants.map((variant) => variant.id)),
  );

  const ranked = candidates
    .map((product) => {
      const variants = product.variants.map((variant) => ({
        ...variant,
        ...(availability.get(variant.id) ?? NO_STOCK),
      }));
      const summary = priceSummary(variants, product.priceCents);

      return {
        id: product.id,
        createdAt: product.createdAt,
        // Sorting and the card both use the "From" price: the lowest among what
        // can still be bought.
        priceCents: summary.priceCents,
        priceVaries: summary.varies,
        state: productAvailability(variants),
        variants,
        basePriceCents: product.priceCents,
      };
    })
    .filter((product) =>
      inPriceRange(
        product.variants,
        product.basePriceCents,
        filters.minPriceCents,
        filters.maxPriceCents,
      ),
    )
    .sort((a, b) => compareFor(sort)(a, b));

  const pageIds = ranked
    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    .map((product) => product.id);
  const rankedById = new Map(ranked.map((product) => [product.id, product]));

  const cards = await prisma.product.findMany({
    where: { id: { in: pageIds } },
    select: cardSelect,
  });
  const byId = new Map(cards.map((card) => [card.id, card]));

  const items = pageIds.flatMap((id) => {
    const card = byId.get(id);
    const summary = rankedById.get(id);
    if (!card || !summary) return [];

    const only = summary.variants.length === 1 ? summary.variants[0] : null;

    return [
      {
        ...card,
        availability: summary.state,
        // Once each: a size made in three colours is still one size.
        sizes: [
          ...new Set(
            card.variants.flatMap((variant) => (variant.option2 ? [variant.option2] : [])),
          ),
        ],
        fromPriceCents: summary.priceCents,
        priceVaries: summary.priceVaries,
        quickAdd: only ? { variantId: only.id, maxQuantity: maxQuantity(only) } : null,
      },
    ];
  });

  return {
    items,
    total: ranked.length,
    page: currentPage,
    pageCount: Math.max(1, Math.ceil(ranked.length / PAGE_SIZE)),
  };
}

/**
 * A single product with its images and variants, for the detail page.
 *
 * Each variant carries its stock and the units other shoppers hold, so the page
 * can say what is free; the product carries the summary for its badge.
 */
export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null },
    include: {
      images: { orderBy: { position: "asc" } },
      categoryRef: true,
      swatches: { orderBy: { position: "asc" }, select: { id: true, name: true, hex: true } },
      variants: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          swatchId: true,
          option2: true,
          priceCents: true,
          swatch: { select: { id: true, name: true, hex: true } },
        },
      },
    },
  });

  if (!product) return null;

  const availability = await getAvailability(product.variants.map((variant) => variant.id));
  const variants = product.variants.map((variant) => ({
    ...variant,
    ...(availability.get(variant.id) ?? NO_STOCK),
  }));

  return { ...product, variants, availability: productAvailability(variants) };
}

/**
 * Every visible product, for the sitemap.
 *
 * Sold items are included deliberately. A sold page still answers the search
 * that led someone to it, and its structured data says SoldOut — dropping them
 * would, in a shop where everything is one of one, eventually remove most of
 * the catalogue from search entirely.
 */
export async function listSitemapEntries(): Promise<{ slug: string; updatedAt: Date }[]> {
  return prisma.product.findMany({
    where: { deletedAt: null },
    select: { slug: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

function whereFor(filters: ProductFilters): Prisma.ProductWhereInput {
  const { sizes, categories, conditions, genders, search } = filters;
  const where: Prisma.ProductWhereInput = { deletedAt: null };

  // In stock in one of the sizes, in any colour: someone filtering by their
  // size wants what they could buy. Sold pieces still show when browsing.
  if (sizes?.length) where.variants = { some: { option2: { in: sizes }, stock: { gt: 0 } } };
  if (categories?.length) where.categoryRef = { slug: { in: categories } };
  if (conditions?.length) where.condition = { in: conditions };
  if (genders?.length) where.gender = { in: genders };

  // Price is filtered after availability is known: see inPriceRange.

  const term = search?.trim();
  if (term) {
    // ILIKE '%term%' across three columns. No index can serve a leading
    // wildcard, so this scans — which is the right trade at a few hundred items
    // and the wrong one at a hundred thousand. The upgrade, when the catalogue
    // earns it, is a tsvector column with a GIN index.
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { brand: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
    ];
  }

  return where;
}

const NO_STOCK: VariantAvailability = { stock: 0, heldByOthers: 0 };

/**
 * Whether a product has something in the price range: a variant that can be
 * bought at a price within it (or, for a sold-out product, any variant, so
 * sold pieces still appear at their price). Prices differ by variant now — the
 * XXL may cost more — so the product's base price alone would be wrong.
 */
function inPriceRange(
  variants: (VariantAvailability & { priceCents: number | null })[],
  baseCents: number,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min === undefined && max === undefined) return true;

  const buyable = variants.filter((variant) => freeUnits(variant) > 0);
  const pool = buyable.length > 0 ? buyable : variants;

  return pool.some((variant) => {
    const price = effectivePrice(variant, baseCents);
    return (min === undefined || price >= min) && (max === undefined || price <= max);
  });
}

type Rankable = { id: string; priceCents: number; createdAt: Date; state: ProductAvailability };

/**
 * Sort order, always led by availability: what can be bought now, then what is
 * in someone's checkout, then what has sold.
 */
function compareFor(sort: ProductSort): (a: Rankable, b: Rankable) => number {
  const secondary = (a: Rankable, b: Rankable) =>
    sort === "price-asc"
      ? a.priceCents - b.priceCents
      : sort === "price-desc"
        ? b.priceCents - a.priceCents
        : b.createdAt.getTime() - a.createdAt.getTime();

  // `id` last so the order is total: two items created in the same millisecond
  // must not swap places between pages, which would drop or duplicate one.
  return (a, b) =>
    AVAILABILITY_RANK[a.state] - AVAILABILITY_RANK[b.state] ||
    secondary(a, b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
