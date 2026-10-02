import { LogOut } from "lucide-react";
import Link from "next/link";

import { getStaffAccess } from "@/lib/admin/access";
import { signOutAction } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { countCartItems } from "@/lib/shop/cart";
import { readCartId } from "@/lib/shop/cart-session";
import { listOrdersBeingChecked } from "@/lib/shop/orders";
import { ThemeSwitcher } from "./theme-switcher";

/**
 * The shop's one piece of persistent navigation.
 *
 * Rendered on the server, so the signed-in state is correct in the first HTML
 * rather than flickering from "Sign in" to a name once JavaScript catches up.
 */
export async function SiteHeader() {
  const user = await getCurrentUser();
  const cartId = await readCartId();
  const cartCount = cartId ? await countCartItems(cartId) : 0;
  // Only asked for somebody signed in; a customer's answer is one empty lookup.
  const isStaff = user ? (await getStaffAccess(user.id)) !== null : false;
  const beingChecked = user ? await listOrdersBeingChecked(user.id) : [];

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">
          The Thrift Plug
        </Link>

        {/* Labels never wrap; on a phone the gaps tighten and Sign out becomes an icon. */}
        <nav className="flex items-center gap-2.5 text-sm whitespace-nowrap sm:gap-4">
          <ThemeSwitcher />

          <Link href="/cart" className="underline-offset-4 hover:underline">
            Cart{cartCount > 0 && <span className="text-neutral-500"> ({cartCount})</span>}
          </Link>

          {user && (
            <Link href="/orders" className="underline-offset-4 hover:underline">
              Orders
              {beingChecked.length > 0 && (
                <span className="text-neutral-500"> ({beingChecked.length})</span>
              )}
            </Link>
          )}

          {isStaff && (
            <Link href="/admin" className="underline-offset-4 hover:underline">
              Admin
            </Link>
          )}

          {user ? (
            <>
              <span className="hidden text-neutral-500 sm:inline dark:text-neutral-400">
                {user.name ?? user.email}
              </span>
              {/*
                A form rather than a link: signing out changes state on the
                server, and anything that changes state should not be reachable
                by a GET — which a browser, a crawler or a link prefetcher is
                free to make on its own.
              */}
              <form action={signOutAction}>
                <button
                  type="submit"
                  title="Sign out"
                  className="flex items-center underline-offset-4 hover:underline"
                >
                  <LogOut aria-hidden className="size-4 sm:hidden" />
                  <span className="sr-only sm:not-sr-only">Sign out</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="underline-offset-4 hover:underline">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>

      {/*
        A reminder on every shop page while a payment is being checked. Somebody
        who has sent money and wandered back to the catalogue should not have
        to remember where to look.
      */}
      {beingChecked.length > 0 && (
        <div className="border-t border-blue-200 bg-blue-50 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <p className="mx-auto flex w-full max-w-7xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
            <span>
              {beingChecked.length === 1 ? (
                <>
                  We are checking your M-Pesa payment for{" "}
                  <span className="font-mono font-medium whitespace-nowrap">
                    {beingChecked[0].reference}
                  </span>
                  .
                </>
              ) : (
                <>We are checking your M-Pesa payments for {beingChecked.length} orders.</>
              )}
            </span>
            <Link
              href={beingChecked.length === 1 ? `/orders/${beingChecked[0].reference}` : "/orders"}
              className="font-medium underline underline-offset-4"
            >
              {beingChecked.length === 1 ? "View order" : "View orders"} →
            </Link>
          </p>
        </div>
      )}
    </header>
  );
}
