import Link from "next/link";

/**
 * Every 404, shop or admin.
 *
 * Deliberately frameless: it renders under the root layout, which has no
 * header, and it is also what a customer sees at an admin address — where
 * showing the admin frame around it would give away what it is hiding.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-muted">
        This page does not exist, or the piece has moved on to a new home.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Back to the shop
      </Link>
    </main>
  );
}
