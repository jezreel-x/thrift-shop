import { LogOut, PanelLeftClose, PanelLeftOpen, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Permission } from "@/generated/prisma/enums";
import { AdminNav } from "@/components/admin/admin-nav";
import { MobileDrawer } from "@/components/admin/mobile-drawer";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getStaffAccess } from "@/lib/admin/access";
import { adminNavFor } from "@/lib/admin/navigation";
import { countOrdersToConfirm } from "@/lib/admin/orders";
import { can } from "@/lib/admin/permissions";
import { isSidebarCollapsed } from "@/lib/admin/sidebar";
import { setSidebarAction } from "@/lib/admin/sidebar-actions";
import { signOutAction } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/current-user";

// Robots only. A title here would be published to customers answered with a
// 404 at admin addresses; each page names itself through staffTitle instead.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The admin frame: sidebar, top bar, and the page.
 *
 * Not a guard. A layout keeps its render across client-side navigation between
 * the pages beneath it, so a check here would not run when it mattered, and a
 * Server Action never passes through it at all. Each page and action calls
 * requirePermission itself; this only decides what frame to draw.
 *
 * For anyone who is not staff it draws no frame — the page beneath will answer
 * with a 404, and the admin menu should not appear around it.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getCurrentUser();
  const access = user ? await getStaffAccess(user.id) : null;

  if (!user || !access) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  // A hint, not a live counter: the layout keeps its render while moving
  // between admin pages, so the number refreshes after a decision (which
  // re-renders everything) or a reload, not on every click.
  const toConfirm = can(access, Permission.ORDERS_VIEW) ? await countOrdersToConfirm() : 0;
  const sections = adminNavFor(access, { orders: toConfirm });
  const collapsed = await isSidebarCollapsed();

  return (
    <div className="flex min-h-screen flex-1">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface-muted/40 lg:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div
          className={`flex h-14 items-center border-b border-border ${collapsed ? "justify-center" : "justify-between px-4"}`}
        >
          {!collapsed && (
            <Link href="/admin" className="text-sm font-semibold tracking-tight">
              The Thrift Plug
            </Link>
          )}
          <form action={setSidebarAction}>
            <button
              type="submit"
              name="sidebar"
              value={collapsed ? "expanded" : "collapsed"}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              title={collapsed ? "Expand menu" : "Collapse menu"}
              className="rounded-md p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden className="size-4" />
              )}
            </button>
          </form>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-5">
          <AdminNav sections={sections} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Solid, not frosted: backdrop-filter makes an element the containing
          block for position:fixed descendants, which would shrink the phone
          drawer inside this bar to the bar's own 56px.
        */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          <MobileDrawer>
            <AdminNav sections={sections} />
          </MobileDrawer>
          <p className="text-sm font-medium">Admin</p>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-muted transition hover:text-foreground"
            >
              <Store aria-hidden className="size-4" />
              <span className="hidden sm:inline">View shop</span>
            </Link>
            <ThemeSwitcher />
            <span className="hidden text-muted md:inline">{user.name ?? user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="rounded-md p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
              >
                <LogOut aria-hidden className="size-4" />
              </button>
            </form>
          </div>
        </header>

        <div className="flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</div>
      </div>
    </div>
  );
}
