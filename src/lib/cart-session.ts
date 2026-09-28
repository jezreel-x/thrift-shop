import { cookies } from "next/headers";

import { getCurrentUser } from "./auth/current-user";
import { CART_COOKIE, type CartContents, findCart, getCartContents } from "./cart";

/**
 * Reading the current shopper's cart from a page.
 *
 * Read-only on purpose: a server component may not set cookies, and creating a
 * cart row as a side effect of rendering would leave one behind for every
 * crawler that ever visited.
 */

/** The current cart's id, or null when the shopper has not started one. */
export async function readCartId(): Promise<string | null> {
  const [user, store] = await Promise.all([getCurrentUser(), cookies()]);

  return findCart({
    userId: user?.id,
    anonymousCartId: store.get(CART_COOKIE)?.value,
  });
}

/**
 * The cart's contents, or an empty cart.
 *
 * The signed-in user's id is passed through as the reservation holder, so an
 * item they are already checking out with reads as available to them rather
 * than as somebody else's hold.
 */
export async function readCart(): Promise<CartContents | null> {
  const [user, cartId] = await Promise.all([getCurrentUser(), readCartId()]);

  if (!cartId) return null;

  return getCartContents(cartId, user?.id);
}
