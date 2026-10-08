import type { Prisma } from "@/generated/prisma/client";
import { type Fulfilment, OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { type CustomerSort, searchTerms } from "./customer-query";

/**
 * The customer register: everyone with an account, with what they have bought.
 *
 * "Orders" and "spent" count confirmed orders only, the ones the shop was
 * actually paid for. A checkout that was never paid, or a payment that was
 * rejected, is not a purchase. "Last order" is the last order that got as far
 * as a payment claim, so an abandoned checkout doesn't make someone look active.
 *
 * Built with Prisma's query builder throughout. It can sort users by their own
 * columns but not by a sum over their orders, so the two activity sorts rank
 * buyers with `order.groupBy` and then list everyone else; see `buyersFirst`.
 *
 * Behind CUSTOMERS_VIEW: names, phone numbers and where people live are the
 * most personal data the shop holds.
 */

export const CUSTOMERS_PAGE_SIZE = 25;

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  joinedAt: Date;
  orders: number;
  spentCents: number;
  lastOrderAt: Date | null;
  isStaff: boolean;
};

const CONFIRMED: Prisma.OrderWhereInput = { status: OrderStatus.CONFIRMED };
/** Got as far as a payment claim: everything except an unpaid checkout. */
const PLACED: Prisma.OrderWhereInput = { status: { not: OrderStatus.AWAITING_PAYMENT } };

export async function listCustomers(input: {
  search: string;
  sort: CustomerSort;
  page: number;
}): Promise<{ customers: CustomerRow[]; total: number; pageCount: number }> {
  const where = whereSearch(input.search);
  const skip = (input.page - 1) * CUSTOMERS_PAGE_SIZE;

  const [total, ids] = await Promise.all([
    prisma.user.count({ where }),
    input.sort === "new"
      ? newestFirst(where, skip, CUSTOMERS_PAGE_SIZE)
      : buyersFirst(where, input.sort, skip, CUSTOMERS_PAGE_SIZE),
  ]);

  return {
    customers: await rowsFor(ids),
    total,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)),
  };
}

/** Ids for one page, newest account first. Ties broken by id, so paging is stable. */
async function newestFirst(
  where: Prisma.UserWhereInput,
  skip: number,
  take: number,
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take,
    select: { id: true },
  });

  return users.map((user) => user.id);
}

/**
 * Ids for one page sorted by activity: buyers first, ranked by what they spent
 * or when they last ordered, then everyone who hasn't bought, newest first.
 *
 * Two lists end to end. A page that falls across the join takes the end of the
 * first and the start of the second.
 */
async function buyersFirst(
  where: Prisma.UserWhereInput,
  sort: "recent" | "spent",
  skip: number,
  take: number,
): Promise<string[]> {
  // "Recent" ranks by the last order that reached a payment claim; "spent" by
  // money actually confirmed. The ranked list is of those who have such an order.
  const ranked: Prisma.OrderWhereInput = sort === "spent" ? CONFIRMED : PLACED;
  const buyerWhere: Prisma.OrderWhereInput = { ...ranked, user: where };

  const buyerCount = await prisma.user.count({
    where: { AND: [where, { orders: { some: ranked } }] },
  });

  const ids: string[] = [];
  if (skip < buyerCount) {
    const groups = await prisma.order.groupBy({
      by: ["userId"],
      where: buyerWhere,
      orderBy:
        sort === "spent"
          ? [{ _sum: { totalCents: "desc" } }, { userId: "asc" }]
          : [{ _max: { createdAt: "desc" } }, { userId: "asc" }],
      skip,
      take,
    });
    ids.push(...groups.map((group) => group.userId));
  }

  const remaining = take - ids.length;
  if (remaining > 0) {
    ids.push(
      ...(await newestFirst(
        { AND: [where, { orders: { none: ranked } }] },
        Math.max(skip - buyerCount, 0),
        remaining,
      )),
    );
  }

  return ids;
}

/** The rows for some users, in the order given, with their totals. */
async function rowsFor(ids: string[]): Promise<CustomerRow[]> {
  if (ids.length === 0) return [];

  const [users, confirmed, placed] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        _count: { select: { staffRoles: true } },
      },
    }),
    prisma.order.groupBy({
      by: ["userId"],
      where: { ...CONFIRMED, userId: { in: ids } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.groupBy({
      by: ["userId"],
      where: { ...PLACED, userId: { in: ids } },
      _max: { createdAt: true },
    }),
  ]);

  const byId = new Map(users.map((user) => [user.id, user]));
  const bought = new Map(confirmed.map((group) => [group.userId, group]));
  const last = new Map(placed.map((group) => [group.userId, group._max.createdAt]));

  return ids.flatMap((id) => {
    const user = byId.get(id);
    if (!user) return [];

    return [
      {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        joinedAt: user.createdAt,
        orders: bought.get(id)?._count._all ?? 0,
        spentCents: bought.get(id)?._sum.totalCents ?? 0,
        lastOrderAt: last.get(id) ?? null,
        isStaff: user._count.staffRoles > 0,
      },
    ];
  });
}

/** Name, email or phone. A full phone number matches however it was typed. */
function whereSearch(search: string): Prisma.UserWhereInput {
  if (!search) return {};

  const { text, phone } = searchTerms(search);

  return {
    OR: [
      { name: { contains: text, mode: "insensitive" } },
      { email: { contains: text, mode: "insensitive" } },
      { phone: { contains: text } },
      ...(phone ? [{ phone }] : []),
    ],
  };
}

export type CustomerDetail = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  joinedAt: Date;
  isStaff: boolean;
  delivery: {
    fulfilment: Fulfilment | null;
    area: string | null;
    address: string | null;
    phone: string | null;
  };
  stats: { orders: number; spentCents: number; lastOrderAt: Date | null };
  orders: {
    reference: string;
    status: OrderStatus;
    totalCents: number;
    createdAt: Date;
    items: number;
  }[];
};

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      fulfilment: true,
      deliveryAddress: true,
      deliveryPhone: true,
      deliveryArea: { select: { name: true } },
      _count: { select: { staffRoles: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        select: {
          reference: true,
          status: true,
          totalCents: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!user) return null;

  const confirmed = user.orders.filter((order) => order.status === OrderStatus.CONFIRMED);
  const placed = user.orders.filter((order) => order.status !== OrderStatus.AWAITING_PAYMENT);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    joinedAt: user.createdAt,
    isStaff: user._count.staffRoles > 0,
    delivery: {
      fulfilment: user.fulfilment,
      area: user.deliveryArea?.name ?? null,
      address: user.deliveryAddress,
      phone: user.deliveryPhone,
    },
    stats: {
      orders: confirmed.length,
      spentCents: confirmed.reduce((sum, order) => sum + order.totalCents, 0),
      lastOrderAt: placed[0]?.createdAt ?? null,
    },
    orders: user.orders.map((order) => ({
      reference: order.reference,
      status: order.status,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      items: order._count.items,
    })),
  };
}
