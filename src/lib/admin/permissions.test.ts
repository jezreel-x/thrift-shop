import { describe, expect, it } from "vitest";

import { Permission } from "@/generated/prisma/enums";
import { ALL_PERMISSIONS, PERMISSION_GROUPS, can, resolveAccess } from "./permissions";

const PACKER = {
  name: "Packer",
  isSuperAdmin: false,
  permissions: [Permission.ORDERS_VIEW, Permission.ORDERS_FULFIL],
};

const CASHIER = {
  name: "Cashier",
  isSuperAdmin: false,
  permissions: [Permission.ORDERS_VIEW, Permission.ORDERS_CONFIRM_PAYMENT],
};

const OWNER = { name: "Owner", isSuperAdmin: true, permissions: [] };

describe("resolveAccess", () => {
  it("says somebody with no roles is not staff at all", () => {
    expect(resolveAccess("u1", [])).toBeNull();
  });

  it("grants exactly what the role lists", () => {
    const access = resolveAccess("u1", [PACKER]);

    expect(can(access, Permission.ORDERS_FULFIL)).toBe(true);
    expect(can(access, Permission.ORDERS_CONFIRM_PAYMENT)).toBe(false);
    expect(can(access, Permission.SETTINGS_EDIT)).toBe(false);
  });

  it("unions several roles, so holding two grants everything either grants", () => {
    const access = resolveAccess("u1", [PACKER, CASHIER]);

    expect([...(access?.permissions ?? [])].sort()).toEqual(
      [Permission.ORDERS_CONFIRM_PAYMENT, Permission.ORDERS_FULFIL, Permission.ORDERS_VIEW].sort(),
    );
    expect(access?.roles).toEqual(["Cashier", "Packer"]);
  });

  it("gives a super-admin every permission without any being listed", () => {
    // Including permissions added to the schema after the role was created —
    // otherwise a new feature would lock out the only person who can grant it.
    const access = resolveAccess("u1", [OWNER]);

    expect(access?.isSuperAdmin).toBe(true);
    for (const permission of ALL_PERMISSIONS) {
      expect(can(access, permission)).toBe(true);
    }
  });
});

describe("can", () => {
  it("refuses everything to somebody who is not staff", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
    }
  });
});

describe("PERMISSION_GROUPS", () => {
  it("describes every permission exactly once, so none is invisible on the Staff screen", () => {
    const described = PERMISSION_GROUPS.flatMap((group) =>
      group.permissions.map((info) => info.permission),
    );

    expect([...described].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});
