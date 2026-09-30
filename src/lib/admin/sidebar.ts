import { cookies } from "next/headers";

/**
 * Whether the admin sidebar is collapsed to icons.
 *
 * A cookie rather than browser storage, for the same reason as the theme: the
 * server draws the sidebar, and a preference it cannot read would render
 * expanded and then snap shut once a script caught up.
 */
export const SIDEBAR_COOKIE = "thrift_admin_sidebar";

export async function isSidebarCollapsed(): Promise<boolean> {
  const store = await cookies();

  return store.get(SIDEBAR_COOKIE)?.value === "collapsed";
}
