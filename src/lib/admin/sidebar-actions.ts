"use server";

import { cookies } from "next/headers";

import { requireStaff } from "./access";
import { SIDEBAR_COOKIE } from "./sidebar";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Collapses or expands the admin sidebar.
 *
 * Harmless on its own, but it is still a public endpoint, and nothing outside
 * the admin area has any business setting admin cookies — so staff only, like
 * every other action in this folder.
 */
export async function setSidebarAction(formData: FormData): Promise<void> {
  await requireStaff();

  const store = await cookies();

  if (formData.get("sidebar") === "collapsed") {
    store.set(SIDEBAR_COOKIE, "collapsed", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
    });
  } else {
    // Expanded is the default, stored as no cookie at all.
    store.delete(SIDEBAR_COOKIE);
  }
}
