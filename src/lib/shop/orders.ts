import { randomInt } from "node:crypto";

import { Fulfilment, OrderStatus } from "@/generated/prisma/enums";
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
 * extended rather than contested, because `reserveProduct` treats the existing
 * holder as entitled.
 */
export async function beginCheckout(
  userId: string,
  cartId: string,
  buyer: { name: string; phone: string },
  /** Null while the shop offers no choice: arranged with the buyer, as before. */
  delivery: DeliveryChoice | null = null,
): Promise<CheckoutResult> {
  const cart = await getCartContents(cartId, userId);

  if (cart.lines.length === 0) return { ok: false, reason: "empty-cart" };

  // Reserve first, then record. Units that cannot be held have no business on
  // an order, and reserving is the only way to find out. Each line asks for its
  // quantity and may be given fewer, which the buyer is told before paying.
  const held: (CartLine & { quantity: number })[] = [];
  const dropped: CartLine[] = [];
  const reduced: { title: string; requested: number; held: number }[] = [];

  for (const line of cart.lines) {
    const result = await reserveVariant(line.variantId, userId, line.quantity);
    if (!result.ok) {
      dropped.push(line);
      continue;
    }

    held.push({ ...line, quantity: result.quantity });
    if (result.quantity < line.quantity) {
      reduced.push({ title: line.title, requested: line.quantity, held: result.quantity });
    }
  }

  if (held.length === 0) {
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
  };
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
    select: { id: true, reference: true, status: true, items: { select: { variantId: true } } },
  });

  if (!order) return { ok: false, reason: "not-found" };
  if (order.status !== OrderStatus.AWAITING_PAYMENT) {
    return { ok: false, reason: "already-claimed" };
  }

  // Extend every hold before recording the claim. Money has changed hands as far
  // as the buyer is concerned, and fifteen minutes is nowhere near long enough
  // for a person to read their messages.
  for (const item of order.items) {
    const extended = item.variantId ? await holdForPaymentReview(item.variantId, userId) : false;
    if (!extended) return { ok: false, reason: "hold-lapsed" };
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PENDING_CONFIRMATION, mpesaCode: code, claimedAt: new Date() },
    });
  } catch {
    // The unique constraint on mpesaCode is what decides this, not a preceding
    // lookup — two orders claiming the same code at once would both pass one.
    return { ok: false, reason: "code-already-used" };
  }

  return { ok: true, reference: order.reference };
}

/** One order, scoped to its buyer so a reference cannot be guessed into. */
export async function getOrder(reference: string, userId: string) {
  return prisma.order.findFirst({
    where: { reference, userId },
    include: {
      items: {
        include: {
          product: { select: { slug: true, images: { take: 1, orderBy: { position: "asc" } } } },
        },
      },
    },
  });
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

/** A buyer's orders, newest first. */
export async function listOrders(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { title: true, priceCents: true } } },
  });
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
