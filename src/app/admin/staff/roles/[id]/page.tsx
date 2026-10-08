import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmButton } from "@/components/admin/confirm-button";
import { RoleForm } from "@/components/admin/role-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { prisma } from "@/lib/prisma";
import { deleteRoleAction } from "@/lib/admin/staff-actions";
import { STAFF_REFUSALS, type StaffRefusal, getRole } from "@/lib/admin/staff";

type Props = PageProps<"/admin/staff/roles/[id]">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const role = await prisma.staffRole.findUnique({ where: { id }, select: { name: true } });

  return role?.name ?? "Role";
}, Permission.STAFF_MANAGE);

export default async function EditRolePage({ params, searchParams }: Props) {
  const { id } = await params;
  await requirePermission(Permission.STAFF_MANAGE, `/admin/staff/roles/${id}`);

  const [role, query] = await Promise.all([getRole(id), searchParams]);
  // The owner role has nothing to edit: it holds every permission.
  if (!role || role.isSuperAdmin) notFound();

  const error =
    typeof query.error === "string" && query.error in STAFF_REFUSALS
      ? STAFF_REFUSALS[query.error as StaffRefusal]
      : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/staff"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Staff &amp; roles
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{role.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {role.members === 1 ? "1 person has" : `${role.members} people have`} this role. Changes
        apply to them from their next click.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      <div className="mt-8">
        <RoleForm
          role={{
            id: role.id,
            name: role.name,
            description: role.description ?? "",
            permissions: role.permissions,
          }}
        />
      </div>

      <section
        aria-labelledby="delete"
        className="mt-12 max-w-3xl rounded-xl border border-red-200 p-5 dark:border-red-900"
      >
        <h2 id="delete" className="font-semibold">
          Delete this role
        </h2>
        {role.members > 0 ? (
          <p className="mt-1 text-sm text-muted">
            {role.members === 1 ? "1 person still has" : `${role.members} people still have`} it.
            Take it away from them on the{" "}
            <Link href="/admin/staff" className="underline underline-offset-4">
              Staff page
            </Link>{" "}
            first, so nobody loses access without you seeing who.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">Nobody has it, so nothing changes for anyone.</p>
            <div className="mt-4">
              <ConfirmButton
                action={deleteRoleAction}
                fields={{ roleId: role.id }}
                label="Delete role"
                title={`Delete ${role.name}?`}
                body="The role and its permissions are removed. The activity log keeps a record of it."
                confirmLabel="Delete"
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
