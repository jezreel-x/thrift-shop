import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";

/**
 * Settings is a group of pages now; its own address goes to the first, so
 * bookmarks and the icon-only sidebar still land somewhere useful.
 */
export default async function SettingsPage() {
  await requirePermission(Permission.SETTINGS_EDIT, "/admin/settings");

  redirect("/admin/settings/payment");
}
