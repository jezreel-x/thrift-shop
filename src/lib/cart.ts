import { ProductStatus } from "@/generated/prisma/enums";
import { prisma } from "./prisma";

/**
 * The cart.
 *
 * A list of intentions, never a claim. Adding an item changes nothing in the
 * catalogue and guarantees nothing — exclusivity is granted only by a
 * reservation, at checkout, for fifteen minutes. See docs/one-of-one-stock.md.
 *
 * Which means the cart has to be honest about items that have gone: two people
 * may hold the same jacket, and the one who does not reach checkout first must
 * be told there and then rather than after paying.
 */

/** The cookie that identifies an anonymous shopper's cart. */
export const CART_COOKIE = "thrift_cart";

/** How long an untouched anonymous cart is kept before the sweep clears it. */
export const ANONYMOUS_CART_DAYS = 30;

export type CartLineUnavailable = "sold" | "held" | "withdrawn";

export type CartLine = {
  productId: string;
  slug: string;
  title: string;
  priceCents: number;
  size: string;
  image: { url: string; alt: string | null; width: number; height: number } | null;
  /** False when this can no longer be bought. */
  available: boolean;
  reason?: CartLineUnavailable;
};

export type CartContents = {
  cartId: string;
  lines: CartLine[];
  /** Only what can actually be paid for — an unavailable line contributes nothing. */
  totalCents: number;
  availableCount: number;
};

/**
 * Finds the cart for this shopper, creating one if needed.
 *
 * A signed-in shopper is found by their user id; an anonymous one by the id in
 * their cookie. The caller is responsible for writing that cookie back, because
 * only a Server Action or Route Handler may set one.
 */
export async function resolveCart(options: {
  userId?: string;
  anonymousCartId?: string;
}): Promise<{ id: string; isNew: boolean }> {
  const { userId, anonymousCartId } = options;

  if (userId) {
    const existing = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (existing) return { id: existing.id, isNew: false };

    const created = await prisma.cart.create({ data: { userId }, select: { id: true } });
    return { id: created.id, isNew: true };
  }

  if (anonymousCartId) {
    // Only an unclaimed cart: a cookie naming a cart that now belongs to an
    // account must not hand that account's cart to whoever holds the cookie.
    const existing = await prisma.cart.findFirst({
      where: { id: anonymousCartId, userId: null },
      select: { id: true },
    });
    if (existing) return { id: existing.id, isNew: false };
  }

  const created = await prisma.cart.create({ data: {}, select: { id: true } });

  return { id: created.id, isNew: true };
}

/**
 * Attaches an anonymous cart to an account, at sign-in or sign-up.
 *
 * Someone who fills a cart and is then asked to sign in should not find it
 * empty on the other side — that is the moment a purchase gets abandoned.
 *
 * Both carts may exist: a shopper with items saved from last week who has since
 * added more while signed out. The anonymous items are moved across, duplicates
 * are dropped, and the empty anonymous cart is removed.
 */
export async function mergeAnonymousCart(
  anonymousCartId: string | undefined,
  userId: string,
): Promise<void> {
  if (!anonymousCartId) return;

  await prisma.$transaction(async (tx) => {
    const anonymous = await tx.cart.findFirst({
      where: { id: anonymousCartId, userId: null },
      select: { id: true, items: { select: { productId: true } } },
    });

    if (!anonymous) return;

    const existing = await tx.cart.findUnique({ where: { userId }, select: { id: true } });

    // Nothing to merge into — the anonymous cart simply becomes theirs, which
    // keeps the item rows and their order untouched.
    if (!existing) {
      await tx.cart.update({ where: { id: anonymous.id }, data: { userId } });
      return;
    }

    if (anonymous.items.length > 0) {
      await tx.cartItem.createMany({
        data: anonymous.items.map((item) => ({
          cartId: existing.id,
          productId: item.productId,
        })),
        // The unique constraint on (cartId, productId) decides duplicates, not a
        // preceding lookup.
        skipDuplicates: true,
      });
    }

    await tx.cart.delete({ where: { id: anonymous.id } });
  });
}

/**
 * Adds an item. Idempotent — adding twice leaves one row, not an error.
 *
 * Deliberately does not check whether the product is available. A cart may hold
 * something somebody else is currently checking out with, because that person
 * may not complete, and refusing here would make the cart quietly wrong the
 * moment a fifteen-minute hold began.
 */
export async function addToCart(cartId: string, productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });

  // Withdrawn or nonexistent is different from unavailable: there is nothing to
  // put in a cart.
  if (!product) return;

  await prisma.cartItem.createMany({
    data: [{ cartId, productId }],
    skipDuplicates: true,
  });

  await touch(cartId);
}

export async function removeFromCart(cartId: string, productId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId, productId } });
  await touch(cartId);
}

export async function clearCart(cartId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId } });
  await touch(cartId);
}

/**
 * The cart, with each line's current availability.
 *
 * `holderId` is the shopper: an item they are already holding a reservation on
 * counts as available to them, which is what makes returning to a cart
 * mid-checkout work rather than reporting their own hold as somebody else's.
 */
export async function getCartContents(cartId: string, holderId?: string): Promise<CartContents> {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    orderBy: { createdAt: "asc" },
    select: {
      product: {
        select: {
          id: true,
          slug: true,
          title: true,
          priceCents: true,
          size: true,
          status: true,
          reservedBy: true,
          reservedUntil: true,
          deletedAt: true,
          images: {
            select: { url: true, alt: true, width: true, height: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  const now = Date.now();

  const lines: CartLine[] = items.map(({ product }) => {
    const reason = unavailableReason(product, holderId, now);

    return {
      productId: product.id,
      slug: product.slug,
      title: product.title,
      priceCents: product.priceCents,
      size: product.size,
      image: product.images[0] ?? null,
      available: reason === undefined,
      ...(reason ? { reason } : {}),
    };
  });

  return {
    cartId,
    lines,
    totalCents: lines.reduce((total, line) => total + (line.available ? line.priceCents : 0), 0),
    availableCount: lines.filter((line) => line.available).length,
  };
}

/** Clears anonymous carts nobody has touched in a long time. */
export async function deleteAbandonedAnonymousCarts(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ANONYMOUS_CART_DAYS * 86_400_000);

  const { count } = await prisma.cart.deleteMany({
    where: { userId: null, updatedAt: { lt: cutoff } },
  });

  return count;
}

function unavailableReason(
  product: {
    status: ProductStatus;
    reservedBy: string | null;
    reservedUntil: Date | null;
    deletedAt: Date | null;
  },
  holderId: string | undefined,
  now: number,
): CartLineUnavailable | undefined {
  if (product.deletedAt) return "withdrawn";
  if (product.status === ProductStatus.SOLD) return "sold";

  if (product.status === ProductStatus.RESERVED) {
    // A lapsed hold belongs to nobody, exactly as the reservation query treats
    // it — so a cart must not report an item as taken when checkout would in
    // fact grant it.
    const lapsed = !product.reservedUntil || product.reservedUntil.getTime() <= now;
    if (lapsed) return undefined;

    return product.reservedBy === holderId ? undefined : "held";
  }

  return undefined;
}

function touch(cartId: string) {
  return prisma.cart.update({ where: { id: cartId }, data: {} });
}
