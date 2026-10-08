import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { RoleForm } from "@/components/admin/role-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";

export const generateMetadata = staffTitle("New role", Permission.STAFF_MANAGE);

export default async function NewRolePage() {
  await requirePermission(Permission.STAFF_MANAGE, "/admin/staff/roles/new");

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/staff"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Staff &amp; roles
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New role</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Name it after the job, such as Cashier or Shop assistant, and tick only what that job needs.
      </p>
      <div className="mt-8">
        <RoleForm role={null} />
      </div>
    </main>
  );
}
