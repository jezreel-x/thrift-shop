"use client";

import {
  ChevronDown,
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

import { type NavIcon, type NavItem, type NavSection, isActive } from "@/lib/admin/navigation";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: ShoppingBag,
  products: Shirt,
  customers: Users,
  settings: Settings,
  staff: ShieldCheck,
};

const ROW = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
const IDLE = "text-muted hover:bg-surface-muted hover:text-foreground";
const CURRENT = "bg-surface-muted font-medium text-foreground";

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
            {section.items.map((item) => (
              <li key={item.href}>
                {item.children && !collapsed ? (
                  <Group item={item} pathname={pathname} />
                ) : (
                  <Item item={item} pathname={pathname} collapsed={collapsed} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * An item with sub-pages: opens and closes, and starts open on one of its own
 * pages. A <details> element, so it works without script and is announced as
 * expandable. Keyed by whether it is current, so arriving on one of its pages
 * opens it even if it was closed by hand elsewhere.
 */
function Group({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon];
  const current = isActive(item.href, pathname);

  return (
    <details key={String(current)} open={current} className="group">
      <summary
        className={`${ROW} cursor-pointer list-none transition [&::-webkit-details-marker]:hidden ${current ? "font-medium text-foreground" : IDLE}`}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted transition group-open:rotate-180"
        />
      </summary>
      <ul className="mt-0.5 ml-5 flex flex-col gap-0.5 border-l border-border pl-2">
        {item.children?.map((child) => {
          const active = isActive(child.href, pathname);

          return (
            <li key={child.href}>
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-1.5 text-sm transition ${active ? CURRENT : IDLE}`}
              >
                {child.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Item({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const Icon = ICONS[item.icon];
  const active = isActive(item.href, pathname);
  const base = `${ROW} ${collapsed ? "justify-center" : ""}`;

  if (!item.ready) {
    // Not a link: the screen does not exist yet, and a link to it would be a
    // link to a 404.
    return (
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
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={`${base} transition ${active ? CURRENT : IDLE}`}
    >
      <span className="relative">
        <Icon aria-hidden className="size-4 shrink-0" />
        {collapsed && item.count ? (
          <span aria-hidden className="absolute -top-1 -right-1 size-2 rounded-full bg-blue-600" />
        ) : null}
      </span>
      <span className={collapsed ? "sr-only" : "flex-1"}>
        {item.label}
        {item.count ? <span className="sr-only"> ({item.count} waiting)</span> : null}
      </span>
      {!collapsed && item.count ? (
        <span
          aria-hidden
          className="rounded-full bg-blue-600 px-1.5 text-[11px] font-medium text-white tabular-nums"
        >
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}
