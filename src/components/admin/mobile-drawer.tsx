"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * The admin menu on a phone: a native <details> element styled as a drawer.
 *
 * <details> opens and closes with no JavaScript at all, so the menu works
 * before the page has hydrated, or if it never does. The script adds only the
 * two things HTML cannot do: close after navigating (a client-side navigation
 * keeps the element, and so keeps it open), and close on tapping outside.
 */
export function MobileDrawer({ children }: { children: ReactNode }) {
  const drawer = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (drawer.current) drawer.current.open = false;
  }, [pathname]);

  const close = () => {
    if (drawer.current) drawer.current.open = false;
  };

  return (
    <details ref={drawer} className="group lg:hidden">
      <summary
        aria-label="Menu"
        // Raised above the open panel so the same button closes it.
        className="flex cursor-pointer list-none items-center rounded-lg p-2 text-muted group-open:relative group-open:z-50 hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Menu aria-hidden className="size-5 group-open:hidden" />
        <X aria-hidden className="hidden size-5 group-open:block" />
      </summary>

      <div aria-hidden onClick={close} className="fixed inset-0 z-40 bg-black/40" />
      <div className="fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] overflow-y-auto border-r border-border bg-surface px-3 pt-16 pb-6">
        {children}
      </div>
    </details>
  );
}
