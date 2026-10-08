import { Pencil, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";

import { ConfirmButton } from "@/components/admin/confirm-button";
import { GrantRoleForm } from "@/components/admin/grant-role-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { PERMISSION_GROUPS } from "@/lib/admin/permissions";
import { revokeRoleAction } from "@/lib/admin/staff-actions";
import { STAFF_REFUSALS, type StaffRefusal, listRoles, listStaff } from "@/lib/admin/staff";

export const generateMetadata = staffTitle("Staff & roles", Permission.STAFF_MANAGE);

const NOTICES: Record<string, string> = {
  revoked: "Done. They lose that role from their next click.",
  "role-created": "Role created. Add people to it below.",
  "role-saved": "Role saved. Everyone with it has the new permissions from their next click.",
  "role-deleted": "Role deleted.",
};

const LABELS = new Map(
  PERMISSION_GROUPS.flatMap((group) => group.permissions).map((info) => [
    info.permission,
    info.label,
  ]),
);

export default async function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  const { user, access } = await requirePermission(Permission.STAFF_MANAGE, "/admin/staff");

  const [staff, roles, query] = await Promise.all([listStaff(), listRoles(), searchParams]);
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" && query.error in STAFF_REFUSALS
      ? STAFF_REFUSALS[query.error as StaffRefusal]
      : undefined;
  // The owner role is offered only to owners: the rules refuse it to anyone else.
  const grantable = roles.filter((role) => access.isSuperAdmin || !role.isSuperAdmin);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Staff &amp; roles</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Who can do what in the admin. A role is a set of permissions; give people roles, and changes
        take effect on their next click.
      </p>

      {(notice || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          }`}
        >
          {error ?? notice}
        </p>
      )}

      <section aria-labelledby="staff" className="mt-8">
        <h2 id="staff" className="text-lg font-semibold">
          Staff
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {staff.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {member.name ?? member.email}
                  {member.id === user.id && <span className="text-muted"> (you)</span>}
                </p>
                {member.name && <p className="truncate text-sm text-muted">{member.email}</p>}
              </div>
              <ul className="flex flex-wrap gap-2">
                {member.roles.map((role) => (
                  <li
                    key={role.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-xs font-medium"
                  >
                    {role.isSuperAdmin && <ShieldCheck aria-hidden className="size-3.5" />}
                    {role.name}
                    {(access.isSuperAdmin || !role.isSuperAdmin) && (
                      <ConfirmButton
                        action={revokeRoleAction}
                        fields={{ userId: member.id, roleId: role.id }}
                        label={
                          <>
                            <X aria-hidden className="size-3.5" />
                            <span className="sr-only">
                              Take {role.name} away from {member.name ?? member.email}
                            </span>
                          </>
                        }
                        title={`Take ${role.name} away?`}
                        body={`${member.name ?? member.email} loses what ${role.name} lets them do from their next click. You can give it back at any time.`}
                        confirmLabel="Take it away"
                        className="rounded-full p-0.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-medium">Add someone</h3>
        <div className="mt-2">
          <GrantRoleForm roles={grantable.map(({ id, name }) => ({ id, name }))} />
        </div>
      </section>

      <section aria-labelledby="roles" className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="roles" className="text-lg font-semibold">
            Roles
          </h2>
          <Link
            href="/admin/staff/roles/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-muted"
          >
            <Plus aria-hidden className="size-4" />
            New role
          </Link>
        </div>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <li
              key={role.id}
              className="flex flex-col rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 font-medium">
                    {role.isSuperAdmin && <ShieldCheck aria-hidden className="size-4" />}
                    {role.name}
                  </p>
                  <p className="text-xs text-muted">
                    {role.members === 1 ? "1 person" : `${role.members} people`}
                  </p>
                </div>
                {!role.isSuperAdmin && (
                  <Link
                    href={`/admin/staff/roles/${role.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs transition hover:bg-surface-muted"
                  >
                    <Pencil aria-hidden className="size-3" />
                    Edit
                    <span className="sr-only"> {role.name}</span>
                  </Link>
                )}
              </div>
              {role.description && <p className="mt-2 text-sm text-muted">{role.description}</p>}
              <p className="mt-3 text-xs text-muted">
                {role.isSuperAdmin
                  ? "Every permission, including any added later."
                  : role.permissions.map((permission) => LABELS.get(permission)).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
