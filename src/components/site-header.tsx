import { Package, ShoppingCart } from "lucide-react";
import Link from "next/link";

import { getStaffAccess } from "@/lib/admin/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { countCartItems } from "@/lib/shop/cart";
import { readCartId } from "@/lib/shop/cart-session";
import { listOrdersBeingChecked } from "@/lib/shop/orders";
import { type AccountMenuLink, AccountMenu } from "./account-menu";
import { HideOnPath } from "./hide-on-path";
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

  // Admin lives in the account menu: only staff need it, and the phone header
  // has no room for a link most visitors never use.
  const menuLinks: AccountMenuLink[] = isStaff
    ? [{ href: "/admin", label: "Admin", icon: "admin" }]
    : [];

  const reminderHref =
    beingChecked.length === 1 ? `/orders/${beingChecked[0].reference}` : "/orders";

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">
          The Thrift Plug
        </Link>

        <nav className="flex items-center gap-3 text-sm whitespace-nowrap sm:gap-4">
          <ThemeSwitcher />

          <Link
            href="/cart"
            aria-label={
              cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"
            }
            title="Cart"
            className="relative rounded-md p-1 transition hover:opacity-75"
          >
            <ShoppingCart aria-hidden className="size-5" />
            {cartCount > 0 && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1.5 min-w-4 rounded-full bg-neutral-900 px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums dark:bg-neutral-100 dark:text-neutral-900"
              >
                {cartCount}
              </span>
            )}
          </Link>

          {user ? (
            <>
              {/* A word where there is room, an icon on a phone, like the cart. */}
              <Link
                href="/orders"
                aria-label={
                  beingChecked.length > 0
                    ? `Orders, ${beingChecked.length} being checked`
                    : "Orders"
                }
                className="relative underline-offset-4 hover:underline"
              >
                <span aria-hidden className="relative block p-1 sm:hidden">
                  <Package className="size-5" />
                  {beingChecked.length > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-4 rounded-full bg-blue-600 px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
                      {beingChecked.length}
                    </span>
                  )}
                </span>
                <span aria-hidden className="hidden sm:inline">
                  Orders
                  {beingChecked.length > 0 && (
                    <span className="text-neutral-500"> ({beingChecked.length})</span>
                  )}
                </span>
              </Link>
              <AccountMenu name={user.name} email={user.email} links={menuLinks} />
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
        to remember where to look. Set within the page's width rather than
        edge to edge, like the content below it.
      */}
      {beingChecked.length > 0 && (
        <div className="mx-auto w-full max-w-7xl px-4 pb-3 sm:px-6">
          <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
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
            {/* Pointless on the page it points to. */}
            <HideOnPath path={reminderHref}>
              <Link href={reminderHref} className="font-medium underline underline-offset-4">
                {beingChecked.length === 1 ? "View order" : "View orders"} →
              </Link>
            </HideOnPath>
          </p>
        </div>
      )}
    </header>
  );
}
