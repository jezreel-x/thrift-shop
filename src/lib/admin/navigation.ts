import { Permission } from "@/generated/prisma/enums";
import { type StaffAccess, can } from "./permissions";

/**
 * The admin menu, and who sees each item.
 *
 * Hiding an item is presentation, not protection — each page enforces its own
 * permission. This only spares staff links that would 404 for them.
 *
 * Plain data, so the server can filter it and hand it to the client component
 * that highlights the current page. Icons travel as names for the same reason:
 * a component cannot cross from server to client as a prop.
 */

export type NavIcon = "dashboard" | "orders" | "products" | "customers" | "settings" | "staff";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** False until the screen exists; drawn as "soon" rather than as a link to a 404. */
  ready: boolean;
  /** Something waiting on this screen, such as payments to confirm. */
  count?: number;
  /**
   * Sub-pages, shown indented under this item. An item with children opens
   * and closes rather than being a page of its own; its href is where the
   * icon-only sidebar sends people, since there is no room for the children.
   */
  children?: NavChild[];
};

/** A sub-page, shown only to people allowed to open it. */
export type NavChild = { href: string; label: string };

/** Children as configured: a permission of their own, where it differs from the parent's. */
type NavChildEntry = NavChild & { permission?: Permission };

export type NavSection = { title: string; items: NavItem[] };

type NavEntry = Omit<NavItem, "children"> & {
  permission: Permission | null;
  children?: NavChildEntry[];
};

const ADMIN_NAV: readonly { title: string; items: readonly NavEntry[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard", permission: null, ready: true },
    ],
  },
  {
    title: "Manage",
    items: [
      {
        href: "/admin/orders",
        label: "Orders",
        icon: "orders",
        permission: Permission.ORDERS_VIEW,
        ready: true,
      },
      {
        href: "/admin/products",
        label: "Products",
        icon: "products",
        permission: Permission.PRODUCTS_VIEW,
        ready: true,
        // Shop-wide places only: a single product's Photos or Stock are tabs
        // on that product, since the menu can't know which product is meant.
        children: [
          { href: "/admin/products", label: "All products" },
          {
            href: "/admin/products/new",
            label: "New product",
            permission: Permission.PRODUCTS_EDIT,
          },
        ],
      },
      {
        href: "/admin/customers",
        label: "Customers",
        icon: "customers",
        permission: Permission.CUSTOMERS_VIEW,
        ready: true,
      },
    ],
  },
  {
    title: "Shop",
    items: [
      {
        href: "/admin/settings",
        label: "Settings",
        icon: "settings",
        permission: Permission.SETTINGS_EDIT,
        ready: true,
        children: [
          { href: "/admin/settings/payment", label: "Payment details" },
          { href: "/admin/settings/whatsapp", label: "WhatsApp" },
          { href: "/admin/settings/delivery", label: "Pickup & delivery" },
          { href: "/admin/settings/rules", label: "Shop rules" },
          { href: "/admin/settings/changes", label: "Recent changes" },
        ],
      },
      {
        href: "/admin/staff",
        label: "Staff & roles",
        icon: "staff",
        permission: Permission.STAFF_MANAGE,
        ready: true,
      },
    ],
  },
];

/**
 * The menu this person may see, with empty sections dropped.
 *
 * `counts` puts a number beside an item: the payments waiting to be confirmed
 * beside Orders. Only for items the person can see, so the menu never reveals
 * how much is waiting on a screen they cannot open.
 */
export function adminNavFor(
  access: StaffAccess,
  counts: Partial<Record<NavIcon, number>> = {},
): NavSection[] {
  return ADMIN_NAV.map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => item.permission === null || can(access, item.permission))
      .map(({ href, label, icon, ready, children }) => ({
        href,
        label,
        icon,
        ready,
        ...(counts[icon] ? { count: counts[icon] } : {}),
        ...(children
          ? {
              children: children
                .filter((child) => !child.permission || can(access, child.permission))
                .map(({ href, label }) => ({ href, label })),
            }
          : {}),
      })),
  })).filter((section) => section.items.length > 0);
}

/**
 * Which of a group's sub-pages is current: the most specific match, so
 * /admin/products/new lights up New product rather than All products, while
 * a product's own pages light up All products.
 */
export function activeChild(children: NavChild[], pathname: string): string | null {
  return (
    children
      .filter((child) => isActive(child.href, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
  );
}

/**
 * Whether a menu item is the current page.
 *
 * The dashboard matches only itself — every admin path starts with /admin.
 * Others match their own subtree, so /admin/orders/TP-7K3M9Q lights up Orders.
 */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";

  return pathname === href || pathname.startsWith(`${href}/`);
}
