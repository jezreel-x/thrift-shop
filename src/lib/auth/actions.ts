"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { CART_COOKIE, mergeAnonymousCart } from "../cart";
import { prisma } from "../prisma";
import { safeReturnTo } from "./current-user";
import {
  checkPassword,
  hashPassword,
  looksLikeEmail,
  normaliseEmail,
  verifyPassword,
} from "./password";
import { SESSION_COOKIE, SESSION_DAYS, createSession, destroySession } from "./session";

/**
 * Sign up, sign in, sign out.
 *
 * Server Actions rather than API routes: the form posts straight to these, Next
 * generates the endpoint, and there is no fetch call, no JSON contract and no
 * URL to keep in step. They also work before any JavaScript has loaded, which on
 * a cheap phone is the difference between a form that works and one that waits.
 */

export type AuthFormState = { error?: string };

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true, // Script cannot read it, so an XSS flaw cannot steal the session.
  sameSite: "lax", // Sent on top-level navigation, withheld from cross-site POSTs.
  secure: process.env.NODE_ENV === "production", // Plain HTTP only in local development.
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
} as const;

/**
 * A real argon2 hash of a value nobody will type.
 *
 * Verified against when no account exists, so that a failed sign-in costs the
 * same time whether or not the address is registered. Without it, "no such user"
 * returns immediately while "wrong password" spends 38ms hashing — and that gap
 * is enough to enumerate which addresses have accounts.
 */
const ABSENT_USER_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$9X1OtlvVEeC8aOqH0UfQbA$DPlOQq0HxrX7WWKOqDFC329QKmMByLTyUczjDarFyWo";

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const next = safeReturnTo(String(formData.get("next") ?? "") || undefined);

  if (!looksLikeEmail(email)) return { error: "Enter a valid email address." };

  const passwordProblem = checkPassword(password);
  if (passwordProblem) return { error: passwordProblem };

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, name: name || null },
      select: { id: true },
    });
    userId = user.id;
  } catch {
    // The unique constraint decides this, not a preceding lookup: two
    // simultaneous sign-ups with the same address would both pass a
    // check-then-insert and one would fail confusingly at the write.
    return { error: "That email already has an account. Sign in instead." };
  }

  await startSession(userId);
  redirect(next);
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeReturnTo(String(formData.get("next") ?? "") || undefined);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // One message for both failures. "No account with that email" hands an
  // attacker a list of who is registered, which is worth having on its own and
  // worth more combined with a password dump from somewhere else.
  const correct = await verifyPassword(user?.passwordHash ?? ABSENT_USER_HASH, password);

  if (!user || !correct) {
    return { error: "Those details do not match an account." };
  }

  await startSession(user.id);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();

  await destroySession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);

  redirect("/");
}

async function startSession(userId: string): Promise<void> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);

  const { token } = await createSession(userId, {
    userAgent: requestHeaders.get("user-agent"),
    // Vercel puts the visitor's address here; the socket address would be its
    // own proxy.
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
  });

  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

  // Somebody who fills a cart and is then asked to sign in must not find it
  // empty on the other side. That is precisely the moment a purchase gets
  // abandoned — and the reason the cart is allowed to exist anonymously at all.
  const anonymousCartId = store.get(CART_COOKIE)?.value;
  if (anonymousCartId) {
    await mergeAnonymousCart(anonymousCartId, userId);
    // The cart is now found by user id; leaving the cookie would have it
    // resolve to a stale, unclaimed cart on the next visit.
    store.delete(CART_COOKIE);
  }
}
