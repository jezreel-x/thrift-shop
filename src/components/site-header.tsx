import Link from "next/link";

import { signOutAction } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * The shop's one piece of persistent navigation.
 *
 * Rendered on the server, so the signed-in state is correct in the first HTML
 * rather than flickering from "Sign in" to a name once JavaScript catches up.
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          The Thrift Plug
        </Link>

        <nav className="flex items-center gap-4 text-sm">
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
                <button type="submit" className="underline-offset-4 hover:underline">
                  Sign out
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
    </header>
  );
}
