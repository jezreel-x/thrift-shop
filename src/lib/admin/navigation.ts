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
};

export type NavSection = { title: string; items: NavItem[] };

type NavEntry = NavItem & { permission: Permission | null };

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
        ready: false,
      },
      {
        href: "/admin/products",
        label: "Products",
        icon: "products",
        permission: Permission.PRODUCTS_VIEW,
        ready: false,
      },
      {
        href: "/admin/customers",
        label: "Customers",
        icon: "customers",
        permission: Permission.CUSTOMERS_VIEW,
        ready: false,
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
        ready: false,
      },
      {
        href: "/admin/staff",
        label: "Staff & roles",
        icon: "staff",
        permission: Permission.STAFF_MANAGE,
        ready: false,
      },
    ],
  },
];

/** The menu this person may see, with empty sections dropped. */
export function adminNavFor(access: StaffAccess): NavSection[] {
  return ADMIN_NAV.map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => item.permission === null || can(access, item.permission))
      .map(({ href, label, icon, ready }) => ({ href, label, icon, ready })),
  })).filter((section) => section.items.length > 0);
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
