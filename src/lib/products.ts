import type { Category, Condition } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";

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
  categories?: Category[];
  conditions?: Condition[];
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
  size: true,
  category: true,
  condition: true,
  status: true,
  createdAt: true,
  images: {
    select: { url: true, alt: true, width: true, height: true },
    orderBy: { position: "asc" },
    // Only the thumbnail. Fetching every image for every card would multiply the
    // rows returned by a listing page by five for nothing anyone can see.
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export type ProductCard = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

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

  // One round trip for both. The count is needed to render pagination, and on a
  // database an ocean away two sequential queries cost twice the latency.
  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      select: cardSelect,
      orderBy: orderFor(sort),
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    total,
    page: currentPage,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** A single product with all of its images, for the detail page. */
export async function getProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, deletedAt: null },
    include: {
      images: { orderBy: { position: "asc" } },
    },
  });
}

/** Every slug currently visible, for the sitemap and static params. */
export async function listProductSlugs(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { slug: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => row.slug);
}

function whereFor(filters: ProductFilters): Prisma.ProductWhereInput {
  const { sizes, categories, conditions, minPriceCents, maxPriceCents, search } = filters;
  const where: Prisma.ProductWhereInput = { deletedAt: null };

  if (sizes?.length) where.size = { in: sizes };
  if (categories?.length) where.category = { in: categories };
  if (conditions?.length) where.condition = { in: conditions };

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

/**
 * Sort order, always led by status.
 *
 * Postgres orders an enum by the order its values were declared, and
 * ProductStatus is declared AVAILABLE, RESERVED, SOLD — which is exactly the
 * order a shopper wants. That is a real coupling between the schema's
 * declaration order and this sort, so it is asserted in the integration tests:
 * reordering the enum would silently float sold items to the top.
 */
function orderFor(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  const secondary: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price-asc"
      ? [{ priceCents: "asc" }]
      : sort === "price-desc"
        ? [{ priceCents: "desc" }]
        : [{ createdAt: "desc" }];

  // `id` last so the order is total: two items created in the same millisecond
  // must not swap places between pages, which would drop or duplicate one.
  return [{ status: "asc" }, ...secondary, { id: "asc" }];
}
