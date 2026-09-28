import { randomInt } from "node:crypto";

import { OrderStatus } from "@/generated/prisma/enums";
import { getCartContents } from "./cart";
import { prisma } from "./prisma";
import { confirmSale, forceRelease, holdForPaymentReview, reserveProduct } from "./reservations";

/**
 * Orders.
 *
 * The moment a cart — which promises nothing — becomes a claim on specific
 * garments. Entering checkout reserves what is still available; submitting an
 * M-Pesa code converts those short holds into long ones while a person checks
 * their messages; the owner's decision either sells the items or returns them.
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
): Promise<CheckoutResult> {
  const cart = await getCartContents(cartId, userId);

  if (cart.lines.length === 0) return { ok: false, reason: "empty-cart" };

  // Reserve first, then record. An item that cannot be held has no business on
  // an order, and reserving is the only way to find out.
  const held: typeof cart.lines = [];
  const dropped: typeof cart.lines = [];

  for (const line of cart.lines) {
    const result = await reserveProduct(line.productId, userId);
    (result.ok ? held : dropped).push(line);
  }

  if (held.length === 0) {
    return { ok: false, reason: "nothing-available" };
  }

  const totalCents = held.reduce((sum, line) => sum + line.priceCents, 0);

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
): Promise<{ ok: true } | { ok: false; reason: ClaimRefusal }> {
  const code = mpesaCode.trim().toUpperCase();

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, status: true, items: { select: { productId: true } } },
  });

  if (!order) return { ok: false, reason: "not-found" };
  if (order.status !== OrderStatus.AWAITING_PAYMENT) {
    return { ok: false, reason: "already-claimed" };
  }

  // Extend every hold before recording the claim. Money has changed hands as far
  // as the buyer is concerned, and fifteen minutes is nowhere near long enough
  // for a person to read their messages.
  for (const item of order.items) {
    const extended = await holdForPaymentReview(item.productId, userId);
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

  return { ok: true };
}

/**
 * The owner accepts the payment: every item on the order becomes SOLD.
 *
 * All or nothing. A half-confirmed order would leave the buyer having paid for
 * items they do not own, which is the failure this whole phase exists to avoid.
 */
export async function confirmOrder(orderId: string, note?: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, status: true, items: { select: { productId: true } } },
  });

  if (!order || order.status !== OrderStatus.PENDING_CONFIRMATION) return false;

  for (const item of order.items) {
    const sold = await confirmSale(item.productId, order.userId);
    if (!sold) return false;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.CONFIRMED, reviewedAt: new Date(), reviewNote: note ?? null },
  });

  return true;
}

/** The owner could not match the payment: every item goes back on the rail. */
export async function rejectOrder(orderId: string, reason: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, items: { select: { productId: true } } },
  });

  if (!order || order.status !== OrderStatus.PENDING_CONFIRMATION) return false;

  for (const item of order.items) {
    await forceRelease(item.productId, `payment rejected: ${reason}`);
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.REJECTED, reviewedAt: new Date(), reviewNote: reason },
  });

  return true;
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

/** A buyer's orders, newest first. */
export async function listOrders(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { title: true, priceCents: true } } },
  });
}

function toOrderItem(line: { productId: string; title: string; size: string; priceCents: number }) {
  return {
    productId: line.productId,
    title: line.title,
    size: line.size,
    priceCents: line.priceCents,
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
