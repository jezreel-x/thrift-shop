import type { Condition, Gender } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import {
  AVAILABILITY_RANK,
  type ProductAvailability,
  type VariantAvailability,
  productAvailability,
} from "./availability";
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
      variants: { select: { id: true } },
    },
  });

  const availability = await getAvailability(
    candidates.flatMap((product) => product.variants.map((variant) => variant.id)),
  );
  const stateOf = (variantIds: { id: string }[]) =>
    productAvailability(variantIds.map(({ id }) => availability.get(id) ?? NO_STOCK));

  const ranked = candidates
    .map((product) => ({ ...product, state: stateOf(product.variants) }))
    .sort((a, b) => compareFor(sort)(a, b));

  const pageIds = ranked
    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    .map((product) => product.id);
  const stateById = new Map(ranked.map((product) => [product.id, product.state]));

  const cards = await prisma.product.findMany({
    where: { id: { in: pageIds } },
    select: cardSelect,
  });
  const byId = new Map(cards.map((card) => [card.id, card]));

  const items = pageIds.flatMap((id) => {
    const card = byId.get(id);
    if (!card) return [];

    return [
      {
        ...card,
        availability: stateById.get(id) ?? "SOLD",
        sizes: card.variants.flatMap((variant) => (variant.option2 ? [variant.option2] : [])),
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
      variants: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
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
  const { sizes, categories, conditions, genders, minPriceCents, maxPriceCents, search } = filters;
  const where: Prisma.ProductWhereInput = { deletedAt: null };

  // Any variant in one of the sizes, sold out or not: the catalogue shows sold
  // pieces, so a size filter must find them too.
  if (sizes?.length) where.variants = { some: { option2: { in: sizes } } };
  if (categories?.length) where.categoryRef = { slug: { in: categories } };
  if (conditions?.length) where.condition = { in: conditions };
  if (genders?.length) where.gender = { in: genders };

  if (minPriceCents !== undefined || maxPriceCents !== undefined) {
    where.priceCents = {
      ...(minPriceCents !== undefined ? { gte: minPriceCents } : {}),
      ...(maxPriceCents !== undefined ? { lte: maxPriceCents } : {}),
    };
  }

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
