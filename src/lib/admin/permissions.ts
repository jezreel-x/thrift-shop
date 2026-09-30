import { Permission } from "@/generated/prisma/enums";

/**
 * What staff may do, as data rather than as checks scattered through the code.
 *
 * A permission names one capability — "confirm a payment", "edit a product" —
 * and a role is just a named bundle of them, chosen by the owner on the Staff
 * screen. Code never asks "is this person a manager?"; it asks "may this person
 * confirm payments?". Roles can then be invented, renamed and reshaped without
 * touching a line of code, which is the whole reason for the matrix.
 *
 * The vocabulary lives in code because a permission only means something where
 * code checks it; who holds which permission lives in the database, because
 * that is the owner's decision. This module is pure — no database — so the
 * rules are unit-tested directly.
 */

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

type PermissionInfo = { permission: Permission; label: string; description: string };

/**
 * Every permission, grouped as the Staff screen shows them.
 *
 * Exhaustive by construction: a unit test fails if a permission is added to the
 * schema without being described here, so none can exist that the owner cannot
 * see or grant.
 */
export const PERMISSION_GROUPS: readonly {
  area: string;
  permissions: readonly PermissionInfo[];
}[] = [
  {
    area: "Orders",
    permissions: [
      {
        permission: Permission.ORDERS_VIEW,
        label: "See orders",
        description: "The order queue, with buyers' names and phone numbers.",
      },
      {
        permission: Permission.ORDERS_CONFIRM_PAYMENT,
        label: "Confirm or reject payments",
        description: "Check an M-Pesa code against the statement and decide the order.",
      },
      {
        permission: Permission.ORDERS_FULFIL,
        label: "Fulfil orders",
        description: "Record packing, dispatch and delivery.",
      },
    ],
  },
  {
    area: "Products",
    permissions: [
      {
        permission: Permission.PRODUCTS_VIEW,
        label: "See products",
        description: "The full catalogue, including removed items.",
      },
      {
        permission: Permission.PRODUCTS_EDIT,
        label: "Add and edit products",
        description: "Photos, prices, descriptions, sizes.",
      },
      {
        permission: Permission.PRODUCTS_MARK_SOLD,
        label: "Mark sold elsewhere",
        description: "Take an item off the site because it sold on WhatsApp or in person.",
      },
      {
        permission: Permission.PRODUCTS_HOLD,
        label: "Hold for a WhatsApp buyer",
        description: "Reserve an item for somebody who asked in a chat.",
      },
    ],
  },
  {
    area: "Customers",
    permissions: [
      {
        permission: Permission.CUSTOMERS_VIEW,
        label: "See customers",
        description: "Accounts, contact details and order history.",
      },
    ],
  },
  {
    area: "Shop",
    permissions: [
      {
        permission: Permission.SETTINGS_EDIT,
        label: "Change payment details",
        description: "Where buyers send money. As sensitive as the till itself.",
      },
      {
        permission: Permission.STAFF_MANAGE,
        label: "Manage staff",
        description: "Create roles and grant them. Effectively full control.",
      },
      {
        permission: Permission.AUDIT_VIEW,
        label: "See the activity log",
        description: "Who did what, and when.",
      },
    ],
  },
];

/** What one staff member may do, resolved from every role they hold. */
export type StaffAccess = {
  userId: string;
  roles: readonly string[];
  isSuperAdmin: boolean;
  permissions: ReadonlySet<Permission>;
};

export type RoleGrant = {
  name: string;
  isSuperAdmin: boolean;
  permissions: readonly Permission[];
};

/**
 * Combines a person's roles into what they may do, or null if they are not staff.
 *
 * The union: holding two roles grants everything either grants. There are no
 * "deny" rules, deliberately — with deny rules, whether somebody can act depends
 * on how grants and denials interact, and the owner can no longer read a
 * person's access off their roles at a glance.
 *
 * A super-admin role grants every permission, including ones added to the
 * schema later. Without that, adding a permission would silently lock the owner
 * out of the new feature until somebody remembered to tick the box — and the
 * only person who can tick it is the owner.
 */
export function resolveAccess(userId: string, roles: readonly RoleGrant[]): StaffAccess | null {
  if (roles.length === 0) return null;

  const isSuperAdmin = roles.some((role) => role.isSuperAdmin);
  const permissions = new Set<Permission>(
    isSuperAdmin ? ALL_PERMISSIONS : roles.flatMap((role) => role.permissions),
  );

  return {
    userId,
    roles: roles.map((role) => role.name).sort(),
    isSuperAdmin,
    permissions,
  };
}

/** Whether this person may do this. Null access — not staff — may do nothing. */
export function can(access: StaffAccess | null, permission: Permission): boolean {
  return access?.permissions.has(permission) ?? false;
}
