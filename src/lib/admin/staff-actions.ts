"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "./access";
import { type RoleField, parseRoleForm } from "./role-form";
import { STAFF_REFUSALS, createRole, deleteRole, grantRole, revokeRole, updateRole } from "./staff";

/**
 * The Staff screen's actions. STAFF_MANAGE for all of them; the rules about
 * the owner role and the last owner are in staff.ts, where no form can skip
 * them.
 */

export type GrantFormState = { error?: string; granted?: string };

export async function grantRoleAction(
  _previous: GrantFormState,
  formData: FormData,
): Promise<GrantFormState> {
  const { user, access } = await requirePermission(Permission.STAFF_MANAGE);

  const email = String(formData.get("email") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "");
  if (!email) return { error: "Enter the email they signed up with." };
  if (!roleId) return { error: "Choose a role to give them." };

  const result = await grantRole({
    email,
    roleId,
    actor: { userId: user.id, isSuperAdmin: access.isSuperAdmin },
  });
  if (!result.ok) return { error: STAFF_REFUSALS[result.reason] };

  revalidatePath("/admin/staff");

  return { granted: email };
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  const { user, access } = await requirePermission(Permission.STAFF_MANAGE);

  const result = await revokeRole({
    userId: String(formData.get("userId") ?? ""),
    roleId: String(formData.get("roleId") ?? ""),
    actor: { userId: user.id, isSuperAdmin: access.isSuperAdmin },
  });

  // The menu is drawn from each person's access; revoking your own role
  // changes yours.
  revalidatePath("/admin", "layout");
  redirect(result.ok ? "/admin/staff?notice=revoked" : `/admin/staff?error=${result.reason}`);
}

export type RoleFormState = { errors?: Partial<Record<RoleField | "form", string>> };

/** Creates a role, or saves one when the form carries its id. */
export async function saveRoleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const { user } = await requirePermission(Permission.STAFF_MANAGE);

  const parsed = parseRoleForm({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    permissions: formData.getAll("permissions").map(String),
  });
  if (!parsed.ok) return { errors: parsed.errors };

  const roleId = String(formData.get("roleId") ?? "");
  const result = roleId
    ? await updateRole({ roleId, value: parsed.value, actorId: user.id })
    : await createRole({ value: parsed.value, actorId: user.id });
  if (!result.ok) {
    const message = STAFF_REFUSALS[result.reason];
    return { errors: result.reason === "name-taken" ? { name: message } : { form: message } };
  }

  revalidatePath("/admin", "layout");
  redirect(`/admin/staff?notice=${roleId ? "role-saved" : "role-created"}`);
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.STAFF_MANAGE);

  const roleId = String(formData.get("roleId") ?? "");
  const result = await deleteRole({ roleId, actorId: user.id });

  revalidatePath("/admin/staff");
  redirect(
    result.ok
      ? "/admin/staff?notice=role-deleted"
      : `/admin/staff/roles/${roleId}?error=${result.reason}`,
  );
}
