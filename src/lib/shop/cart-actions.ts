"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { getCurrentUser } from "../auth/current-user";
import {
  ANONYMOUS_CART_DAYS,
  CART_COOKIE,
  addToCart,
  clearCart,
  removeFromCart,
  resolveCart,
  setCartQuantity,
} from "./cart";

/**
 * Changing the cart.
 *
 * Only these may create a cart or write its cookie — a Server Action is one of
 * the two places Next allows a cookie to be set, and creating a cart is exactly
 * the kind of side effect that has no business happening while a page renders.
 */

const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  // Outlives the sweep that clears abandoned anonymous carts, so the cookie
  // never points at something deliberately deleted.
  maxAge: (ANONYMOUS_CART_DAYS + 1) * 24 * 60 * 60,
} as const;

export async function addToCartAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) return;
  const quantity = Number(formData.get("quantity") ?? 1) || 1;

  const cartId = await currentCart();
  await addToCart(cartId, variantId, quantity);

  // The header's count and the item's own button both change.
  revalidatePath("/", "layout");
}

export async function removeFromCartAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) return;

  const cartId = await currentCart();
  await removeFromCart(cartId, variantId);

  revalidatePath("/", "layout");
}

/**
 * Sets a line's quantity: the − and + of a stepper, each its own small form.
 * Zero removes the line. Capped at what is free when the cart is next shown,
 * and at five by the database.
 */
export async function setCartQuantityAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  const quantity = Number(formData.get("quantity"));
  if (!variantId || !Number.isFinite(quantity)) return;

  const cartId = await currentCart();
  await setCartQuantity(cartId, variantId, quantity);

  revalidatePath("/", "layout");
}

export async function clearCartAction(): Promise<void> {
  const cartId = await currentCart();
  await clearCart(cartId);

  revalidatePath("/", "layout");
}

/**
 * The shopper's cart, created on first use.
 *
 * An anonymous shopper gets a cookie. They can fill a cart without an account,
 * and it follows them into one when they sign in — being asked to authenticate
 * before you may even *consider* buying is where people leave.
 */
async function currentCart(): Promise<string> {
  const [user, store] = await Promise.all([getCurrentUser(), cookies()]);

  const { id, isNew } = await resolveCart({
    userId: user?.id,
    anonymousCartId: store.get(CART_COOKIE)?.value,
  });

  // A signed-in shopper's cart is found by their user id, so it needs no cookie
  // — and writing one would leave a stale anonymous pointer behind after they
  // sign out.
  if (!user && isNew) {
    store.set(CART_COOKIE, id, CART_COOKIE_OPTIONS);
  }

  return id;
}
