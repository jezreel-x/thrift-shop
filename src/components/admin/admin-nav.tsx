"use client";

import {
  LayoutDashboard,
  type LucideIcon,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { type NavIcon, type NavSection, isActive } from "@/lib/admin/navigation";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: ShoppingBag,
  products: Shirt,
  customers: Users,
  settings: Settings,
  staff: ShieldCheck,
};

/**
 * The admin menu's links.
 *
 * The only client component in the shell, and only because of one question:
 * which page is this? The layout above it does not re-render when moving
 * between admin pages, so it cannot answer; the browser's URL can.
 */
export function AdminNav({
  sections,
  collapsed = false,
}: {
  sections: NavSection[];
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.title}>
          <p
            className={
              collapsed
                ? "sr-only"
                : "px-3 pb-2 text-[11px] font-medium tracking-wider text-muted uppercase"
            }
          >
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(item.href, pathname);
              const base = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${collapsed ? "justify-center" : ""}`;

              return (
                <li key={item.href}>
                  {item.ready ? (
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`${base} transition ${
                        active
                          ? "bg-surface-muted font-medium text-foreground"
                          : "text-muted hover:bg-surface-muted hover:text-foreground"
                      }`}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
                    </Link>
                  ) : (
                    // Not a link: the screen does not exist yet, and a link to
                    // it would be a link to a 404.
                    <span
                      aria-disabled="true"
                      title={collapsed ? `${item.label} (soon)` : undefined}
                      className={`${base} cursor-default text-muted opacity-60`}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className={collapsed ? "sr-only" : "flex-1"}>{item.label}</span>
                      {!collapsed && (
                        <span className="rounded-full border border-border px-1.5 text-[10px] tracking-wide uppercase">
                          Soon
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
