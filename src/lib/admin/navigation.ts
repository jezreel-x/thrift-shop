import type { Permission } from "@/generated/prisma/enums";
import { type StaffAccess, can } from "./permissions";

/**
 * The admin menu, and who sees each item.
 *
 * Hiding an item is presentation, not protection — each page enforces its own
 * permission. This only spares staff links that would 404 for them.
 *
 * Items are added as their screens are built: Orders, Products, Customers,
 * Settings, Staff & roles.
 */
type NavItem = { href: string; label: string; permission: Permission | null };

const ADMIN_NAV: readonly NavItem[] = [{ href: "/admin", label: "Dashboard", permission: null }];

export function adminNavFor(access: StaffAccess): NavItem[] {
  return ADMIN_NAV.filter((item) => item.permission === null || can(access, item.permission));
}
