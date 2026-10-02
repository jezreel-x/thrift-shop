"use client";

import { LogOut, type LucideIcon, Package, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { signOutAction } from "@/lib/auth/actions";

/**
 * Icons travel as names, not components: the header that builds these links
 * is a server component, and a component (a function) cannot cross into the
 * client. The same rule as the admin menu.
 */
const ICONS = { admin: ShieldCheck, orders: Package, shop: Store } satisfies Record<
  string,
  LucideIcon
>;

export type AccountMenuLink = { href: string; label: string; icon: keyof typeof ICONS };

/**
 * The signed-in person's avatar, opening a menu with their name and Sign out.
 *
 * Built in layers so nothing depends on JavaScript having loaded:
 *
 *   - The menu is a <details> element, which opens and closes natively.
 *   - Sign out is a real form posting to the sign-out action.
 *   - With JavaScript, submitting it first opens a confirmation <dialog>;
 *     without it, it signs out directly. Nobody is ever left with a button
 *     that does nothing.
 *
 * The <dialog> is the browser's own modal: it traps focus, closes on Escape,
 * dims the page behind it, and is announced as a dialog by screen readers.
 */
export function AccountMenu({
  name,
  email,
  links = [],
}: {
  name: string | null;
  email: string;
  links?: AccountMenuLink[];
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const pathname = usePathname();

  // A client-side navigation keeps the element, and with it an open menu.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  // Close on a click outside or on Escape, the way a menu is expected to.
  useEffect(() => {
    const close = (event: Event) => {
      const element = menu.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && element.contains(event.target as Node)) return;
      element.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const label = name?.trim() || email;
  const initials = initialsOf(name, email);

  return (
    <>
      <details ref={menu} className="relative">
        <summary
          aria-label={`Account menu for ${label}`}
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white transition select-none hover:opacity-85 dark:bg-neutral-100 dark:text-neutral-900 [&::-webkit-details-marker]:hidden"
        >
          {initials}
        </summary>

        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface text-left text-sm whitespace-normal shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate font-medium">{label}</p>
            {name && <p className="truncate text-xs text-muted">{email}</p>}
          </div>

          {links.length > 0 && (
            <ul className="border-b border-border py-1">
              {links.map(({ href, label: text, icon }) => {
                const Icon = ICONS[icon];

                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className="flex items-center gap-3 px-4 py-2 text-foreground transition hover:bg-surface-muted"
                    >
                      <Icon aria-hidden className="size-4 text-muted" />
                      {text}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <form
            ref={form}
            action={signOutAction}
            onSubmit={(event) => {
              if (confirmed.current) return;
              event.preventDefault();
              if (menu.current) menu.current.open = false;
              dialog.current?.showModal();
            }}
            className="p-1"
          >
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              <LogOut aria-hidden className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </details>

      <dialog
        ref={dialog}
        aria-labelledby="sign-out-title"
        // whitespace-normal: this sits inside the header nav, which never wraps.
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-left whitespace-normal text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 id="sign-out-title" className="text-lg font-semibold">
          Sign out?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Your cart and orders stay saved. You will need your password to sign back in.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              confirmed.current = true;
              dialog.current?.close();
              form.current?.requestSubmit();
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Sign out
          </button>
        </div>
      </dialog>
    </>
  );
}

/** "Grace Wanjiku" → "GW", "grace" → "G", and the email's first letter otherwise. */
export function initialsOf(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();

  return (email.trim()[0] ?? "?").toUpperCase();
}
