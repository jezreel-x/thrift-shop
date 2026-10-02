import Link from "next/link";

import { Permission } from "@/generated/prisma/enums";
import { requireStaff } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { countOrdersToConfirm } from "@/lib/admin/orders";
import { PERMISSION_GROUPS, can } from "@/lib/admin/permissions";

export const generateMetadata = staffTitle("Dashboard");

export default async function AdminDashboardPage() {
  const { user, access } = await requireStaff("/admin");

  const groups = PERMISSION_GROUPS.map((group) => ({
    area: group.area,
    held: group.permissions.filter((info) => can(access, info.permission)),
  })).filter((group) => group.held.length > 0);

  const toConfirm = can(access, Permission.ORDERS_VIEW) ? await countOrdersToConfirm() : null;

  return (
    <main className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {user.name ?? user.email} · {access.roles.join(", ")}
      </p>

      {toConfirm !== null && (
        <Link
          href="/admin/orders"
          className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5 transition hover:bg-surface-muted/60"
        >
          <span>
            <span className="block text-[11px] font-medium tracking-wider text-muted uppercase">
              Payments to confirm
            </span>
            <span className="mt-1 block text-3xl font-semibold tabular-nums">{toConfirm}</span>
          </span>
          <span className="text-sm text-muted">
            {toConfirm === 0 ? "All caught up" : "Review the queue →"}
          </span>
        </Link>
      )}

      <h2 className="mt-10 text-[11px] font-medium tracking-wider text-muted uppercase">
        What you can do
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <li key={group.area} className="rounded-xl border border-border bg-surface p-5">
            <p className="font-medium">{group.area}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {group.held.map((info) => (
                <li key={info.permission}>{info.label}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
