"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders its children everywhere except at one address.
 *
 * For links in the shared header that point at the page you might already be
 * on: "View order" while viewing that order is a link to nowhere. The header is
 * a server component drawn by the layout, which does not know the current
 * path, so this one question is answered in the browser.
 */
export function HideOnPath({ path, children }: { path: string; children: ReactNode }) {
  return usePathname() === path ? null : children;
}
