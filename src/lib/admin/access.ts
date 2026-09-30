import { notFound } from "next/navigation";
import { cache } from "react";

import type { Permission } from "@/generated/prisma/enums";
import { requireUser } from "../auth/current-user";
import type { SessionUser } from "../auth/session";
import { prisma } from "../prisma";
import { type StaffAccess, can, resolveAccess } from "./permissions";

/**
 * The admin guard.
 *
 * Every admin page and every admin Server Action begins by calling
 * {@link requirePermission} (or {@link requireStaff}, for pages any staff member
 * may see). Not the layout: a layout does not re-render on client navigation, so
 * a check there is skipped when moving between admin pages, and it never runs
 * at all for a Server Action — which is a public POST endpoint that anybody can
 * call directly, whatever the UI shows or hides. A static test fails the build
 * if an admin page or action forgets.
 */

export type Staff = { user: SessionUser; access: StaffAccess };

/**
 * What this person may do, or null if they hold no role.
 *
 * Read from the database on every request rather than stored in the session,
 * so revoking a role takes effect on the next click. Memoised for the duration
 * of one request, since the layout and the page both ask.
 */
export const getStaffAccess = cache(async (userId: string): Promise<StaffAccess | null> => {
  const assignments = await prisma.staffRoleAssignment.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          name: true,
          isSuperAdmin: true,
          permissions: { select: { permission: true } },
        },
      },
    },
  });

  return resolveAccess(
    userId,
    assignments.map(({ role }) => ({
      name: role.name,
      isSuperAdmin: role.isSuperAdmin,
      permissions: role.permissions.map(({ permission }) => permission),
    })),
  );
});

/**
 * A signed-in staff member, or the request goes no further.
 *
 * Signed out: sent to sign in and brought back. Signed in but not staff: a 404,
 * not a 403. The admin area does not announce itself to customers — "this page
 * exists but is not for you" is information, and there is no reason to give it.
 */
export async function requireStaff(returnTo = "/admin"): Promise<Staff> {
  const user = await requireUser(returnTo);
  const access = await getStaffAccess(user.id);

  if (!access) notFound();

  return { user, access };
}

/**
 * A staff member holding this permission, or a 404.
 *
 * A 404 for staff too, for the same reason and one more: the navigation only
 * offers what somebody may use, so the only way to arrive here without the
 * permission is to type or replay the URL.
 */
export async function requirePermission(
  permission: Permission,
  returnTo = "/admin",
): Promise<Staff> {
  const staff = await requireStaff(returnTo);

  if (!can(staff.access, permission)) notFound();

  return staff;
}
