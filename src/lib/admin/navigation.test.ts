import { describe, expect, it } from "vitest";

import { Permission } from "@/generated/prisma/enums";
import { adminNavFor, isActive } from "./navigation";
import { resolveAccess } from "./permissions";

const labels = (sections: ReturnType<typeof adminNavFor>) =>
  sections.flatMap((section) => section.items.map((item) => item.label));

describe("adminNavFor", () => {
  it("shows an owner every item", () => {
    const owner = resolveAccess("u1", [{ name: "Owner", isSuperAdmin: true, permissions: [] }]);

    expect(labels(adminNavFor(owner!))).toEqual([
      "Dashboard",
      "Orders",
      "Products",
      "Customers",
      "Settings",
      "Staff & roles",
    ]);
  });

  it("shows a packer only what they can open, and drops the empty sections", () => {
    const packer = resolveAccess("u1", [
      { name: "Packer", isSuperAdmin: false, permissions: [Permission.ORDERS_VIEW] },
    ]);

    const sections = adminNavFor(packer!);

    expect(labels(sections)).toEqual(["Dashboard", "Orders"]);
    expect(sections.map((section) => section.title)).toEqual(["Overview", "Manage"]);
  });

  it("hands the client plain data, with no permission attached", () => {
    const owner = resolveAccess("u1", [{ name: "Owner", isSuperAdmin: true, permissions: [] }]);

    for (const item of adminNavFor(owner!).flatMap((section) => section.items)) {
      expect(Object.keys(item).sort()).toEqual(["href", "icon", "label", "ready"]);
    }
  });
});

describe("isActive", () => {
  it("lights the dashboard only on the dashboard itself", () => {
    expect(isActive("/admin", "/admin")).toBe(true);
    expect(isActive("/admin", "/admin/orders")).toBe(false);
  });

  it("lights a section on its own page and everything beneath it", () => {
    expect(isActive("/admin/orders", "/admin/orders")).toBe(true);
    expect(isActive("/admin/orders", "/admin/orders/TP-7K3M9Q")).toBe(true);
  });

  it("does not confuse a section with one that merely shares a prefix", () => {
    expect(isActive("/admin/staff", "/admin/staffing")).toBe(false);
  });
});
