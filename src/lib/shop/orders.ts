import { randomInt } from "node:crypto";

import { Fulfilment, OrderStatus, PaymentChannel, PaymentStatus } from "@/generated/prisma/enums";
import { getCartContents } from "./cart";
import { type DeliveryChoice, deliveryFee } from "./delivery";
import { prisma } from "../prisma";
import type { CartLine } from "./cart";
import { holdForPaymentReview, reserveVariant } from "./reservations";

/**
 * Orders.
 *
 * The moment a cart — which promises nothing — becomes a claim on specific
 * garments. Entering checkout reserves what is still available; submitting an
 * M-Pesa code converts those short holds into long ones while a person checks
 * their messages. The decision that follows is staff's, in admin/orders.ts.
 */

/**
 * No 0/O, no 1/I/L. The reference gets read aloud over WhatsApp and typed back
 * by somebody not looking at the screen, and those are the characters that get
 * heard wrong.
 */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const REFERENCE_LENGTH = 6;
const REFERENCE_ATTEMPTS = 5;

export type CheckoutRefusal = "empty-cart" | "nothing-available";

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      reference: string;
      /** Items that could not be reserved, so checkout can say what dropped out. */
      droppedTitles: string[];
      /** Lines held in part, because fewer were free than were asked for. */
      reduced: { title: string; requested: number; held: number }[];
      /** When the holds run out, and with them the chance to pay for this order. */
      heldUntil: Date;
    }
  | { ok: false; reason: CheckoutRefusal };

/**
 * Turns the available part of a cart into an order, holding each item.
 *
 * Proceeds with what it can rather than refusing the lot. Stopping to ask about
 * one sold item risks losing two more while the buyer decides — so the dropped
 * titles come back with the order and checkout names them plainly before
 * anything is paid.
 *
 * Re-enterable: a buyer who refreshes, or who leaves and comes back inside the
 * window, finds the same order rather than a second one. Their own holds are
 * extended rather than contested, because `reserveVariant` treats the existing
 * holder as entitled.
 *
 * Only inside the window. An order whose holds ran out is closed first, and
 * coming back after that starts a new order: reviving the old one would carry
 * its reference and its date into a checkout days later.
 */
export async function beginCheckout(
  userId: string,
  cartId: string,
  buyer: { name: string; phone: string },
  /** Null while the shop offers no choice: arranged with the buyer, as before. */
  delivery: DeliveryChoice | null = null,
): Promise<CheckoutResult> {
  await cancelLapsedCheckout(userId);

  const cart = await getCartContents(cartId, userId);

  if (cart.lines.length === 0) return { ok: false, reason: "empty-cart" };

  // Reserve first, then record. Units that cannot be held have no business on
  // an order, and reserving is the only way to find out. Each line asks for its
  // quantity and may be given fewer, which the buyer is told before paying.
  const held: (CartLine & { quantity: number })[] = [];
  const dropped: CartLine[] = [];
  const reduced: { title: string; requested: number; held: number }[] = [];
  let until: Date | null = null;

  for (const line of cart.lines) {
    const result = await reserveVariant(line.variantId, userId, line.quantity);
    if (!result.ok) {
      dropped.push(line);
      continue;
    }

    held.push({ ...line, quantity: result.quantity });
    if (!until || result.reservedUntil < until) until = result.reservedUntil;
    if (result.quantity < line.quantity) {
      reduced.push({ title: line.title, requested: line.quantity, held: result.quantity });
    }
  }

  if (held.length === 0 || !until) {
    return { ok: false, reason: "nothing-available" };
  }

  // The delivery fee is part of what the buyer sends by M-Pesa, so it is part
  // of the total staff check the payment against. Today's fee for the area.
  const totalCents =
    held.reduce((sum, line) => sum + line.priceCents * line.quantity, 0) + deliveryFee(delivery);
  const fulfilment = toOrderDelivery(delivery);

  const order = await prisma.$transaction(async (tx) => {
    const open = await tx.order.findFirst({
      where: { userId, status: OrderStatus.AWAITING_PAYMENT },
      select: { id: true, reference: true },
    });

    if (open) {
      // Rebuild the lines: what is reservable may have changed since the buyer
      // last looked, and the order must describe what they are about to pay for
      // now, not then.
      await tx.orderItem.deleteMany({ where: { orderId: open.id } });
      await tx.order.update({
        where: { id: open.id },
        data: {
          totalCents,
          buyerName: buyer.name,
          buyerPhone: buyer.phone,
          ...fulfilment,
          items: { create: held.map(toOrderItem) },
        },
      });

      return open;
    }

    return tx.order.create({
      data: {
        reference: await uniqueReference(tx),
        userId,
        buyerName: buyer.name,
        buyerPhone: buyer.phone,
        totalCents,
        ...fulfilment,
        items: { create: held.map(toOrderItem) },
      },
      select: { id: true, reference: true },
    });
  });

  return {
    ok: true,
    orderId: order.id,
    reference: order.reference,
    droppedTitles: dropped.map((line) => line.title),
    reduced,
    heldUntil: until,
  };
}

type UnpaidOrder = {
  id: string;
  userId: string;
  items: { variantId: string; quantity: number }[];
};

const UNPAID_ORDER = {
  id: true,
  userId: true,
  items: { select: { variantId: true, quantity: true } },
} as const;

/**
 * When each unpaid order's holds run out: the earliest of its buyer's live
 * holds on its lines. Null once any line is no longer held, which is the moment
 * the order stops being payable — a code sent after that is refused, and the
 * buyer is told to check out again.
 *
 * Read from the holds themselves, not worked out from the order's dates, so it
 * can never disagree with what checkout and the stock count see.
 */
export async function heldUntil(
  orders: UnpaidOrder[],
  now: Date = new Date(),
): Promise<Map<string, Date | null>> {
  const holds =
    orders.length === 0
      ? []
      : await prisma.stockHold.findMany({
          where: {
            expiresAt: { gt: now },
            OR: orders.map((order) => ({
              holder: order.userId,
              variantId: { in: order.items.map((item) => item.variantId) },
            })),
          },
          select: { holder: true, variantId: true, quantity: true, expiresAt: true },
        });
  const holdOf = new Map(holds.map((hold) => [`${hold.holder} ${hold.variantId}`, hold]));

  return new Map(
    orders.map((order) => {
      let until: Date | null = null;
      for (const item of order.items) {
        const hold = holdOf.get(`${order.userId} ${item.variantId}`);
        if (!hold || hold.quantity < item.quantity) return [order.id, null];
        if (!until || hold.expiresAt < until) until = hold.expiresAt;
      }

      return [order.id, until];
    }),
  );
}

/**
 * Closes the buyer's unpaid order if its holds have run out, so their next
 * checkout starts a new one. Nothing was paid, so nothing is owed: CANCELLED.
 */
async function cancelLapsedCheckout(userId: string, now: Date = new Date()): Promise<void> {
  const open = await prisma.order.findFirst({
    where: { userId, status: OrderStatus.AWAITING_PAYMENT },
    select: UNPAID_ORDER,
  });
  if (!open || (await heldUntil([open], now)).get(open.id)) return;

  await prisma.order.updateMany({
    where: { id: open.id, status: OrderStatus.AWAITING_PAYMENT },
    data: { status: OrderStatus.CANCELLED },
  });
}

/**
 * Closes unpaid orders whose holds ran out, for the daily housekeeping.
 *
 * Only those last checked out before `cutoff` (a day ago, from housekeeping), so
 * the buyer's page says "your hold ran out" for a while before it says
 * "cancelled". The cutoff is checked again in the update itself: a buyer who
 * checks out again while this runs bumps the order's `updatedAt`, and keeps it.
 *
 * Orders with a payment claimed are never touched. Those wait on staff, and
 * whatever was paid is settled by the one rule in payments/settle.ts.
 */
export async function cancelLapsedCheckouts(cutoff: Date, now: Date = new Date()): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: OrderStatus.AWAITING_PAYMENT, updatedAt: { lt: cutoff } },
    select: UNPAID_ORDER,
  });
  const held = await heldUntil(stale, now);
  const lapsed = stale.filter((order) => !held.get(order.id)).map((order) => order.id);
  if (lapsed.length === 0) return 0;

  const { count } = await prisma.order.updateMany({
    where: {
      id: { in: lapsed },
      status: OrderStatus.AWAITING_PAYMENT,
      updatedAt: { lt: cutoff },
    },
    data: { status: OrderStatus.CANCELLED },
  });

  return count;
}

export type ClaimRefusal = "not-found" | "already-claimed" | "code-already-used" | "hold-lapsed";

/**
 * Records the buyer's claim that they have paid.
 *
 * Nothing here verifies anything — in v1 the app cannot ask Safaricom whether a
 * code is real. What it can do is refuse to let one code be spent twice, which
 * the unique constraint decides, and extend the holds so an item is not resold
 * while the owner is asleep.
 */
export async function claimPayment(
  orderId: string,
  userId: string,
  mpesaCode: string,
): Promise<{ ok: true; reference: string } | { ok: false; reason: ClaimRefusal }> {
  const code = mpesaCode.trim().toUpperCase();

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      ...UNPAID_ORDER,
      reference: true,
      status: true,
      totalCents: true,
      buyerPhone: true,
    },
  });

  if (!order) return { ok: false, reason: "not-found" };
  if (order.status !== OrderStatus.AWAITING_PAYMENT) {
    return { ok: false, reason: "already-claimed" };
  }

  // The whole order first, so a hold that ran out on one line doesn't leave
  // the others extended for a day on an order that can't be paid.
  if (!(await heldUntil([order])).get(order.id)) return { ok: false, reason: "hold-lapsed" };

  // Extend every hold before recording the claim. Money has changed hands as far
  // as the buyer is concerned, and fifteen minutes is nowhere near long enough
  // for a person to read their messages.
  for (const item of order.items) {
    const extended = await holdForPaymentReview(item.variantId, userId);
    if (!extended) return { ok: false, reason: "hold-lapsed" };
  }

  try {
    // The order and its payment record change together. Both carry the code,
    // and both refuse it twice, so one receipt can't pay for two orders
    // whichever record is checked.
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PENDING_CONFIRMATION, mpesaCode: code, claimedAt: new Date() },
      }),
      prisma.payment.create({
        data: {
          orderId,
          channel: PaymentChannel.MPESA_MANUAL,
          status: PaymentStatus.CLAIMED,
          amountCents: order.totalCents,
          receipt: code,
          phone: order.buyerPhone,
        },
      }),
    ]);
  } catch {
    // The unique constraint on mpesaCode is what decides this, not a preceding
    // lookup — two orders claiming the same code at once would both pass one.
    return { ok: false, reason: "code-already-used" };
  }

  return { ok: true, reference: order.reference };
}

/**
 * One order, scoped to its buyer so a reference cannot be guessed into.
 * `heldUntil` is set only while it is unpaid and still held.
 */
export async function getOrder(reference: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { reference, userId },
    include: {
      payments: { select: { refundNote: true } },
      items: {
        include: {
          product: { select: { slug: true, images: { take: 1, orderBy: { position: "asc" } } } },
        },
      },
    },
  });
  if (!order) return null;

  const held =
    order.status === OrderStatus.AWAITING_PAYMENT
      ? ((await heldUntil([order])).get(order.id) ?? null)
      : null;

  return { ...order, heldUntil: held };
}

/**
 * A buyer's orders waiting for the shop to check their payment, newest first.
 *
 * For the reminder under the shop header: somebody who has sent money and
 * wandered back to the catalogue should not have to remember where to look.
 */
export async function listOrdersBeingChecked(userId: string) {
  return prisma.order.findMany({
    where: { userId, status: OrderStatus.PENDING_CONFIRMATION },
    orderBy: { claimedAt: "desc" },
    select: { reference: true },
  });
}

/** A buyer's orders, newest first, each unpaid one marked if its hold ran out. */
export async function listOrders(userId: string) {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { title: true, variantId: true, quantity: true } } },
  });
  const held = await heldUntil(
    orders.filter((order) => order.status === OrderStatus.AWAITING_PAYMENT),
  );

  return orders.map((order) => ({
    ...order,
    lapsed: order.status === OrderStatus.AWAITING_PAYMENT && !held.get(order.id),
  }));
}

/**
 * How the order reaches the buyer, copied onto it. Every field is written,
 * nulls included, so an order re-entered after switching from delivery to
 * pickup keeps nothing of the old address.
 */
function toOrderDelivery(choice: DeliveryChoice | null) {
  return {
    fulfilment: choice?.fulfilment ?? null,
    pickupAddress: choice?.fulfilment === Fulfilment.PICKUP ? choice.pickupAddress : null,
    deliveryArea: choice?.fulfilment === Fulfilment.DELIVERY ? choice.area.name : null,
    deliveryAddress: choice?.fulfilment === Fulfilment.DELIVERY ? choice.address : null,
    deliveryPhone: choice?.fulfilment === Fulfilment.DELIVERY ? choice.phone : null,
    deliveryFeeCents: deliveryFee(choice),
  };
}

/** The order line: a snapshot of what was agreed, so later edits never rewrite it. */
function toOrderItem(line: CartLine & { quantity: number }) {
  return {
    productId: line.productId,
    variantId: line.variantId,
    title: line.title,
    swatch: line.swatch,
    size: line.size,
    priceCents: line.priceCents,
    quantity: line.quantity,
  };
}

/**
 * A reference nobody already has.
 *
 * Retried rather than assumed unique: 31^6 is large, but "large" is not "never",
 * and the constraint is what actually decides it.
 */
async function uniqueReference(tx: {
  order: { findUnique: (args: { where: { reference: string } }) => Promise<unknown> };
}): Promise<string> {
  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = randomReference();
    if (!(await tx.order.findUnique({ where: { reference } }))) return reference;
  }

  throw new Error("Could not allocate an unused order reference.");
}

function randomReference(): string {
  let out = "";
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }

  return `TP-${out}`;
}
