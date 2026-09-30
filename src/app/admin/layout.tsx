import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getStaffAccess } from "@/lib/admin/access";
import { adminNavFor } from "@/lib/admin/navigation";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin" },
  robots: { index: false, follow: false },
};

/**
 * The admin menu. Not a guard.
 *
 * A layout keeps its render across client-side navigation between the pages
 * beneath it, so a check here would not run when it mattered, and a Server
 * Action never passes through it at all. Each page and action calls
 * requirePermission itself; this only decides which links to draw.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getCurrentUser();
  const access = user ? await getStaffAccess(user.id) : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 sm:px-6">
      {access && (
        <nav
          aria-label="Admin"
          className="flex gap-4 overflow-x-auto border-b border-neutral-200 py-3 text-sm dark:border-neutral-800"
        >
          {adminNavFor(access).map((item) => (
            <Link key={item.href} href={item.href} className="underline-offset-4 hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </div>
  );
}
