"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tabs along the top of a product: one page each, so each saves only its
 * own part. A client component only to know which tab is open.
 */
export function ProductTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Product" className="mt-6 border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = pathname === tab.href;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`block border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition ${
                  active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
