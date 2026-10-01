import { requireStaff } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { PERMISSION_GROUPS, can } from "@/lib/admin/permissions";

export const generateMetadata = staffTitle("Dashboard");

export default async function AdminDashboardPage() {
  const { user, access } = await requireStaff("/admin");

  const groups = PERMISSION_GROUPS.map((group) => ({
    area: group.area,
    held: group.permissions.filter((info) => can(access, info.permission)),
  })).filter((group) => group.held.length > 0);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {user.name ?? user.email} · {access.roles.join(", ")}
      </p>

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
