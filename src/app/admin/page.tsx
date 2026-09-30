import type { Metadata } from "next";

import { requireStaff } from "@/lib/admin/access";
import { PERMISSION_GROUPS, can } from "@/lib/admin/permissions";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const { user, access } = await requireStaff("/admin");

  return (
    <main className="w-full max-w-2xl flex-1 py-8 lg:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Signed in as {user.name ?? user.email} · {access.roles.join(", ")}
      </p>

      <h2 className="mt-10 text-sm font-medium tracking-wide text-neutral-500 uppercase">
        What you can do
      </h2>
      <dl className="mt-4 space-y-6">
        {PERMISSION_GROUPS.map((group) => {
          const held = group.permissions.filter((info) => can(access, info.permission));
          if (held.length === 0) return null;

          return (
            <div key={group.area}>
              <dt className="font-medium">{group.area}</dt>
              <dd className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {held.map((info) => info.label).join(" · ")}
              </dd>
            </div>
          );
        })}
      </dl>
    </main>
  );
}
