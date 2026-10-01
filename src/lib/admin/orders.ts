import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus } from "@/generated/prisma/enums";
import { normalisePhone } from "../phone";
import { prisma } from "../prisma";
import { confirmSaleIn, releaseHoldIn } from "../shop/reservations";
import { recordAudit } from "./audit";

/**
 * Staff decisions on orders, and the queue they are made from.
 *
 * A decision is one transaction with three parts, in this order:
 *
 *   1. Claim it: move the order out of PENDING_CONFIRMATION with a conditional
 *      update. If two people press Confirm and Reject at the same moment, both
 *      updates name the same row; Postgres makes the second wait for the first,
 *      re-checks its WHERE clause, and finds nothing left to match. One wins.
 *   2. Apply it to every item.
 *   3. Record it in the audit log.
 *
 * Any failure rolls back all three, so there is no half-decided order: no item
 * sold on an order still marked pending, and no audit entry for a decision that
 * never happened.
 */

export type DecisionRefusal =
  /** No such order. */
  | "not-found"
  /** Somebody already confirmed or rejected it, or it was never claimed. */
  | "already-decided"
  /** At least one item's hold ran out; it may belong to somebody else now. */
  | "hold-lapsed";

export type DecisionResult =
  { ok: true; reference: string } | { ok: false; reason: DecisionRefusal; titles?: string[] };

/** Thrown inside a transaction to roll it back, carrying what went wrong. */
class HoldLapsed extends Error {
  constructor(readonly titles: string[]) {
    super("hold lapsed");
  }
}

/**
 * Accepts the payment: every item on the order becomes SOLD.
 *
 * All or nothing. If any item's hold has run out, nothing is sold and the order
 * stays pending, because the lapsed item may already be in another buyer's
 * checkout — and confirming would sell one jacket twice.
 */
export async function confirmOrder(input: {
  orderId: string;
  actorId: string;
  note?: string;
}): Promise<DecisionResult> {
  const note = input.note?.trim() || null;

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();

      const claimed = await claimDecision(tx, input.orderId, {
        status: OrderStatus.CONFIRMED,
        reviewedAt: now,
        reviewNote: note,
      });
      if (!claimed.ok) return claimed;

      const lapsed: string[] = [];
      for (const item of claimed.order.items) {
        const sold = await confirmSaleIn(tx, item.productId, claimed.order.userId, now);
        if (!sold) lapsed.push(item.title);
      }
      if (lapsed.length > 0) throw new HoldLapsed(lapsed);

      await recordAudit(tx, {
        actorId: input.actorId,
        action: "order.confirm-payment",
        entityType: "Order",
        entityId: input.orderId,
        before: { status: OrderStatus.PENDING_CONFIRMATION },
        after: { status: OrderStatus.CONFIRMED, ...(note ? { note } : {}) },
      });

      return { ok: true as const, reference: claimed.order.reference };
    });
  } catch (error) {
    if (error instanceof HoldLapsed) {
      return { ok: false, reason: "hold-lapsed", titles: error.titles };
    }
    throw error;
  }
}

/**
 * Turns the payment down: every item the buyer still holds goes back on the rail.
 *
 * "Still holds" matters. If a hold lapsed and the sweep returned the item, it
 * may since have been reserved by somebody else, and that reservation is theirs
 * — releasing it would take the item away from a buyer mid-payment. So each
 * release names this order's buyer, and an item held by anyone else is left
 * exactly as it is.
 *
 * The reason is shown to the buyer on their order page.
 */
export async function rejectOrder(input: {
  orderId: string;
  actorId: string;
  reason: string;
}): Promise<DecisionResult> {
  const reason = input.reason.trim();

  return prisma.$transaction(async (tx) => {
    const claimed = await claimDecision(tx, input.orderId, {
      status: OrderStatus.REJECTED,
      reviewedAt: new Date(),
      reviewNote: reason,
    });
    if (!claimed.ok) return claimed;

    let released = 0;
    for (const item of claimed.order.items) {
      if (
        await releaseHoldIn(tx, item.productId, claimed.order.userId, `payment rejected: ${reason}`)
      ) {
        released += 1;
      }
    }

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "order.reject-payment",
      entityType: "Order",
      entityId: input.orderId,
      before: { status: OrderStatus.PENDING_CONFIRMATION },
      after: { status: OrderStatus.REJECTED, reason, itemsReturned: released },
    });

    return { ok: true as const, reference: claimed.order.reference };
  });
}

/**
 * Moves a pending order to its decided state, if nobody has got there first.
 *
 * The update comes before any read, deliberately: reading the status first and
 * then writing is the lost-update pattern this codebase avoids everywhere else.
 */
async function claimDecision(
  tx: Prisma.TransactionClient,
  orderId: string,
  data: { status: OrderStatus; reviewedAt: Date; reviewNote: string | null },
) {
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: OrderStatus.PENDING_CONFIRMATION },
    data,
  });

  if (count === 0) {
    const exists = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
    return {
      ok: false as const,
      reason: exists ? ("already-decided" as const) : ("not-found" as const),
    };
  }

  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { reference: true, userId: true, items: { select: { productId: true, title: true } } },
  });

  return { ok: true as const, order };
}

// --- The queue -------------------------------------------------------------

export const QUEUE_PAGE_SIZE = 20;

/**
 * Orders in one state, matching an optional search, a page at a time.
 *
 * Orders waiting for a decision come oldest claim first: the buyer who has been
 * waiting longest is the one most likely to be messaging the shop already.
 * Everything else is newest first, because that is what someone looking back
 * through history wants to see.
 */
export async function listOrdersForReview(query: {
  status: OrderStatus;
  search?: string;
  page: number;
}) {
  const where: Prisma.OrderWhereInput = {
    status: query.status,
    ...searchCondition(query.search),
  };

  const orderBy: Prisma.OrderOrderByWithRelationInput[] =
    query.status === OrderStatus.PENDING_CONFIRMATION
      ? [{ claimedAt: "asc" }, { createdAt: "asc" }]
      : [{ createdAt: "desc" }];

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * QUEUE_PAGE_SIZE,
      take: QUEUE_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        buyerName: true,
        buyerPhone: true,
        mpesaCode: true,
        totalCents: true,
        createdAt: true,
        claimedAt: true,
        items: { select: { title: true }, orderBy: { title: "asc" } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, pageCount: Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE)) };
}

/** How many orders are in each state, for the tabs and the menu badge. */
export async function countOrdersByStatus(): Promise<Record<OrderStatus, number>> {
  const groups = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });

  const counts = Object.fromEntries(
    Object.values(OrderStatus).map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;
  for (const group of groups) counts[group.status] = group._count._all;

  return counts;
}

/** Just the number waiting for a decision. Cheap: it reads the status index. */
export function countOrdersToConfirm(): Promise<number> {
  return prisma.order.count({ where: { status: OrderStatus.PENDING_CONFIRMATION } });
}

/**
 * One order with everything a reviewer needs: what was bought, whether each
 * hold is still this buyer's, and who has done what to it.
 */
export async function getOrderForReview(reference: string) {
  const order = await prisma.order.findUnique({
    where: { reference: reference.toUpperCase() },
    include: {
      user: { select: { email: true } },
      items: {
        orderBy: { title: "asc" },
        include: {
          product: {
            select: {
              slug: true,
              status: true,
              reservedBy: true,
              reservedUntil: true,
              images: { take: 1, orderBy: { position: "asc" }, select: { url: true, alt: true } },
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  const history = await prisma.auditLog.findMany({
    where: { entityType: "Order", entityId: order.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      action: true,
      after: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return { ...order, history };
}

/**
 * What a reviewer might type into the search box: a reference, an M-Pesa code,
 * a name, or a phone number in any of the ways Kenyans write one.
 */
function searchCondition(search: string | undefined): Prisma.OrderWhereInput {
  const term = search?.trim();
  if (!term) return {};

  const conditions: Prisma.OrderWhereInput[] = [
    { reference: { contains: term.toUpperCase() } },
    { mpesaCode: { contains: term.toUpperCase() } },
    { buyerName: { contains: term, mode: "insensitive" } },
  ];

  // Phones are stored as 2547XXXXXXXX. A whole number is matched exactly once
  // normalised; a fragment ("345 678") is matched by its digits.
  const phone = normalisePhone(term);
  const digits = term.replace(/\D/g, "");
  if (phone) conditions.push({ buyerPhone: phone });
  else if (digits.length >= 4)
    conditions.push({ buyerPhone: { contains: digits.replace(/^0/, "") } });

  return { OR: conditions };
}
