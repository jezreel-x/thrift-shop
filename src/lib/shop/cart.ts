import { prisma } from "../prisma";
import { MAX_PER_LINE, type VariantAvailability, freeUnits, maxQuantity } from "./availability";
import { getAvailability } from "./reservations";

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
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  /** Option-1 value, "Khaki" — null when the product has none. */
  swatch: string | null;
  /** Option-2 value, "32" — empty when the product has none. */
  size: string;
  /** The price of one unit of this variant. */
  priceCents: number;
  /** What the shopper asked for. */
  quantity: number;
  /**
   * What they can actually have right now: the quantity, lowered to what is
   * free. Less than `quantity` means stock fell since it was added.
   */
  quantityAvailable: number;
  /** The most the stepper may offer: what is free, capped per line. */
  maxQuantity: number;
  image: { url: string; alt: string | null; width: number; height: number } | null;
  /** False when none of this can be bought. */
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
      select: {
        id: true,
        items: { select: { productId: true, variantId: true, quantity: true } },
      },
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
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        // The unique constraint on (cartId, variantId) decides duplicates, not a
        // preceding lookup. Where both carts had the same variant, the signed-in
        // cart's quantity stands.
        skipDuplicates: true,
      });
    }

    await tx.cart.delete({ where: { id: anonymous.id } });
  });
}

/**
 * Adds units of a variant. Adding a variant already in the cart raises its
 * quantity, never past {@link MAX_PER_LINE}.
 *
 * Deliberately does not check stock. A cart may hold something somebody else is
 * checking out with, because that person may not complete; the cart is checked
 * against what is free every time it is shown, and checkout decides.
 */
export async function addToCart(cartId: string, variantId: string, quantity = 1): Promise<void> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, product: { deletedAt: null } },
    select: { id: true, productId: true },
  });

  // Withdrawn or nonexistent is different from unavailable: there is nothing to
  // put in a cart.
  if (!variant) return;

  const adding = clampQuantity(quantity);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
      select: { quantity: true },
    });

    await tx.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, productId: variant.productId, variantId, quantity: adding },
      update: { quantity: clampQuantity((existing?.quantity ?? 0) + adding) },
    });
  });

  await touch(cartId);
}

/** Sets a line's quantity, for the steppers. Zero or less removes it. */
export async function setCartQuantity(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) return removeFromCart(cartId, variantId);

  await prisma.cartItem.updateMany({
    where: { cartId, variantId },
    data: { quantity: clampQuantity(quantity) },
  });
  await touch(cartId);
}

export async function removeFromCart(cartId: string, variantId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId, variantId } });
  await touch(cartId);
}

export async function clearCart(cartId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId } });
  await touch(cartId);
}

/**
 * The cart, with each line's current availability.
 *
 * `holderId` is the shopper: units they already hold count as theirs, which is
 * what makes returning to a cart mid-checkout work rather than reporting their
 * own hold as somebody else's.
 */
export async function getCartContents(cartId: string, holderId?: string): Promise<CartContents> {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    orderBy: { createdAt: "asc" },
    select: {
      quantity: true,
      variant: {
        select: {
          id: true,
          option2: true,
          priceCents: true,
          swatch: { select: { name: true } },
          product: {
            select: {
              id: true,
              slug: true,
              title: true,
              priceCents: true,
              deletedAt: true,
              images: {
                select: { url: true, alt: true, width: true, height: true },
                orderBy: { position: "asc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const availability = await getAvailability(
    items.map((item) => item.variant.id),
    holderId,
  );

  const lines: CartLine[] = items.flatMap(({ quantity, variant }) => {
    const { product } = variant;
    const counts = availability.get(variant.id) ?? { stock: 0, heldByOthers: 0 };
    const reason = unavailableReason(product.deletedAt, counts);

    return [
      {
        variantId: variant.id,
        productId: product.id,
        slug: product.slug,
        title: product.title,
        swatch: variant.swatch?.name ?? null,
        size: variant.option2 ?? "",
        priceCents: variant.priceCents ?? product.priceCents,
        quantity,
        quantityAvailable: reason ? 0 : Math.min(quantity, freeUnits(counts)),
        maxQuantity: reason ? 0 : maxQuantity(counts),
        image: product.images[0] ?? null,
        available: reason === undefined,
        ...(reason ? { reason } : {}),
      },
    ];
  });

  return {
    cartId,
    lines,
    totalCents: lines.reduce((total, line) => total + line.priceCents * line.quantityAvailable, 0),
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

/**
 * Why a line cannot be bought, or undefined when it can.
 *
 * Counts only unexpired holds, exactly as reserving does, so the cart never
 * calls something taken that checkout would in fact grant.
 */
function unavailableReason(
  deletedAt: Date | null,
  counts: VariantAvailability,
): CartLineUnavailable | undefined {
  if (deletedAt) return "withdrawn";
  if (counts.stock <= 0) return "sold";
  if (freeUnits(counts) <= 0) return "held";

  return undefined;
}

/** A whole number from 1 to {@link MAX_PER_LINE}. */
function clampQuantity(quantity: number): number {
  return Math.min(MAX_PER_LINE, Math.max(1, Math.trunc(quantity) || 1));
}

function touch(cartId: string) {
  return prisma.cart.update({ where: { id: cartId }, data: {} });
}

/**
 * Finds an existing cart without creating one.
 *
 * Separate from {@link resolveCart} because a server component rendering a page
 * must not have the side effect of creating a row — every visit from a crawler
 * would leave one behind.
 */
export async function findCart(options: {
  userId?: string;
  anonymousCartId?: string;
}): Promise<string | null> {
  const { userId, anonymousCartId } = options;

  if (userId) {
    const cart = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    return cart?.id ?? null;
  }

  if (!anonymousCartId) return null;

  const cart = await prisma.cart.findFirst({
    where: { id: anonymousCartId, userId: null },
    select: { id: true },
  });

  return cart?.id ?? null;
}

/** How many units are in a cart, for the header: two of one shirt counts as two. */
export async function countCartItems(cartId: string): Promise<number> {
  const { _sum } = await prisma.cartItem.aggregate({
    where: { cartId },
    _sum: { quantity: true },
  });

  return _sum.quantity ?? 0;
}
