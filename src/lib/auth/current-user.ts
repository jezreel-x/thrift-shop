import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, type SessionUser, readSession } from "./session";

/**
 * Who is signed in, or null.
 *
 * Safe to call from any server component. Costs one lookup by primary key,
 * against a database the page is already querying to render itself.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();

  return readSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Who is signed in, or a redirect to sign in and come back.
 *
 * `returnTo` is carried through the sign-in and sign-up forms so that being
 * asked to authenticate mid-purchase costs a password rather than the buyer's
 * place in the shop.
 */
export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  }

  return user;
}

/**
 * Reduces a `?next=` parameter to somewhere within this site.
 *
 * Without this the parameter is an open redirect: an attacker sends
 * `/sign-in?next=https://evil.example/login`, the visitor signs in on the real
 * site, is bounced to a convincing copy, and types their password again. The
 * phishing link is genuinely ours, which is what makes it work.
 *
 * So: only a path, only absolute within the site, and never protocol-relative —
 * `//evil.example` is a URL a browser will follow off-site despite looking like
 * a path.
 */
export function safeReturnTo(next: string | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  // A backslash is treated as a slash by some browsers when resolving URLs.
  if (next.startsWith("/\\")) return fallback;

  return next;
}
