import type { Permission } from "@/generated/prisma/enums";
import { ALL_PERMISSIONS } from "./permissions";
import { OWNER_ROLE } from "./staff";

/**
 * Reading the role form: a name, what it is for, and its permissions. Pure,
 * so the rules are unit-tested.
 */

const MAX_NAME = 40;
const MAX_DESCRIPTION = 200;

export type RoleInput = { name: string; description: string | null; permissions: Permission[] };

export type RoleField = "name" | "description" | "permissions";

export type RoleParse =
  { ok: true; value: RoleInput } | { ok: false; errors: Partial<Record<RoleField, string>> };

export function parseRoleForm(input: {
  name: string;
  description: string;
  /** Every ticked box; unknown values are dropped, never trusted. */
  permissions: string[];
}): RoleParse {
  const errors: Partial<Record<RoleField, string>> = {};

  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) errors.name = "Give the role a name, such as Cashier.";
  else if (name.length > MAX_NAME) errors.name = `At most ${MAX_NAME} characters.`;
  // The owner role is the bootstrap's, with every permission; a look-alike
  // made here would be mistaken for it.
  else if (name.toLowerCase() === OWNER_ROLE.toLowerCase()) {
    errors.name = `"${OWNER_ROLE}" is the shop owner's role. Choose another name.`;
  }

  const description = input.description.trim().replace(/\s+/g, " ");
  if (description.length > MAX_DESCRIPTION) {
    errors.description = `At most ${MAX_DESCRIPTION} characters.`;
  }

  const permissions = ALL_PERMISSIONS.filter((permission) =>
    input.permissions.includes(permission),
  );
  if (permissions.length === 0) errors.permissions = "Tick at least one thing this role may do.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { name, description: description || null, permissions } };
}
