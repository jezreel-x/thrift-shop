import { describe, expect, it } from "vitest";

import { Permission } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { getStaffAccess } from "./access";
import {
  OWNER_ROLE,
  createRole,
  deleteRole,
  grantOwnerRole,
  grantRole,
  listStaff,
  revokeRole,
  updateRole,
} from "./staff";

cleanDatabaseBetweenTests();

async function account(email: string, name?: string) {
  return db.user.create({
    data: { email, name, passwordHash: await hashPassword("a good passphrase") },
  });
}

/** An owner, as the bootstrap script makes one. */
async function owner(email = "owner@example.com", name = "Wanjiru") {
  const user = await account(email, name);
  await grantOwnerRole(email);

  return { user, actor: { userId: user.id, isSuperAdmin: true } };
}

const CASHIER = {
  name: "Cashier",
  description: "Confirms payments.",
  permissions: [Permission.ORDERS_VIEW, Permission.ORDERS_CONFIRM_PAYMENT],
};

async function ownerRoleId() {
  return (await db.staffRole.findUniqueOrThrow({ where: { name: OWNER_ROLE } })).id;
}

describe("roles", () => {
  it("creates, renames and re-permissions a role, auditing each change", async () => {
    const { user } = await owner();

    const created = await createRole({ value: CASHIER, actorId: user.id });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateRole({
      roleId: created.id,
      value: { name: "Till", description: null, permissions: [Permission.ORDERS_VIEW] },
      actorId: user.id,
    });
    expect(updated).toEqual({ ok: true });

    const role = await db.staffRole.findUniqueOrThrow({
      where: { id: created.id },
      include: { permissions: true },
    });
    expect([role.name, role.permissions.map((row) => row.permission)]).toEqual([
      "Till",
      [Permission.ORDERS_VIEW],
    ]);
    expect(
      (
        await db.auditLog.findMany({
          where: { entityType: "StaffRole" },
          orderBy: { createdAt: "asc" },
        })
      ).map((entry) => entry.action),
    ).toEqual(["staff.create-role", "staff.update-role"]);
  });

  it("refuses a second role with the same name", async () => {
    const { user } = await owner();
    await createRole({ value: CASHIER, actorId: user.id });

    expect(await createRole({ value: CASHIER, actorId: user.id })).toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  it("never changes or deletes the owner role", async () => {
    const { user } = await owner();
    const roleId = await ownerRoleId();

    expect(await updateRole({ roleId, value: CASHIER, actorId: user.id })).toEqual({
      ok: false,
      reason: "owner-role-fixed",
    });
    expect(await deleteRole({ roleId, actorId: user.id })).toEqual({
      ok: false,
      reason: "owner-role-fixed",
    });
  });

  it("deletes a role only once nobody has it", async () => {
    const { user, actor } = await owner();
    await account("amina@example.com");
    const created = await createRole({ value: CASHIER, actorId: user.id });
    if (!created.ok) throw new Error("not created");
    await grantRole({ email: "amina@example.com", roleId: created.id, actor });

    expect(await deleteRole({ roleId: created.id, actorId: user.id })).toEqual({
      ok: false,
      reason: "role-in-use",
    });

    const amina = await db.user.findUniqueOrThrow({ where: { email: "amina@example.com" } });
    await revokeRole({ userId: amina.id, roleId: created.id, actor });
    expect(await deleteRole({ roleId: created.id, actorId: user.id })).toEqual({ ok: true });
    expect(await db.staffRole.count()).toBe(1);
  });
});

describe("granting and revoking", () => {
  it("grants a role by email, which takes effect on the next request", async () => {
    const { user, actor } = await owner();
    const amina = await account("amina@example.com", "Amina");
    const cashier = await createRole({ value: CASHIER, actorId: user.id });
    if (!cashier.ok) throw new Error("not created");

    expect(await grantRole({ email: " Amina@Example.com ", roleId: cashier.id, actor })).toEqual({
      ok: true,
    });
    expect([...(await getStaffAccess(amina.id))!.permissions].sort()).toEqual(
      [...CASHIER.permissions].sort(),
    );
    expect(await grantRole({ email: "amina@example.com", roleId: cashier.id, actor })).toEqual({
      ok: false,
      reason: "already-held",
    });
    expect(await grantRole({ email: "nobody@example.com", roleId: cashier.id, actor })).toEqual({
      ok: false,
      reason: "no-account",
    });

    await revokeRole({ userId: amina.id, roleId: cashier.id, actor });
    expect(await getStaffAccess(amina.id)).toBeNull();
    expect(
      await db.auditLog.findFirst({ where: { action: "staff.revoke-role", entityId: amina.id } }),
    ).toMatchObject({ actorId: user.id, before: { role: "Cashier" } });
  });

  it("lets only an owner give or take away the owner role", async () => {
    const { user } = await owner();
    const manager = await account("manager@example.com");
    await account("amina@example.com");
    const managers = await createRole({
      value: { name: "Manager", description: null, permissions: [Permission.STAFF_MANAGE] },
      actorId: user.id,
    });
    if (!managers.ok) throw new Error("not created");
    await db.staffRoleAssignment.create({ data: { userId: manager.id, roleId: managers.id } });
    const asManager = { userId: manager.id, isSuperAdmin: false };

    expect(
      await grantRole({
        email: "manager@example.com",
        roleId: await ownerRoleId(),
        actor: asManager,
      }),
    ).toEqual({ ok: false, reason: "owner-only" });
    expect(
      await revokeRole({ userId: user.id, roleId: await ownerRoleId(), actor: asManager }),
    ).toEqual({ ok: false, reason: "owner-only" });
  });

  it("never removes the last owner, even an owner removing themselves", async () => {
    const { user, actor } = await owner();

    expect(await revokeRole({ userId: user.id, roleId: await ownerRoleId(), actor })).toEqual({
      ok: false,
      reason: "last-owner",
    });

    // With a second owner, either may step down.
    await account("second@example.com");
    await grantRole({ email: "second@example.com", roleId: await ownerRoleId(), actor });
    expect(await revokeRole({ userId: user.id, roleId: await ownerRoleId(), actor })).toEqual({
      ok: true,
    });
  });

  it("keeps an owner however many step down at the same moment", async () => {
    // Ten owners all revoking themselves at once. Without the lock, each counts
    // ten owners before any of them commits, and all ten succeed.
    const owners = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        owner(`owner${index}@example.com`, `Owner ${index}`),
      ),
    );
    const roleId = await ownerRoleId();

    const results = await Promise.all(
      owners.map(({ user, actor }) => revokeRole({ userId: user.id, roleId, actor })),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(9);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "last-owner" }]);
    expect(await db.staffRoleAssignment.count({ where: { roleId } })).toBe(1);
  });

  it("lists staff with their roles, owners first", async () => {
    const { user, actor } = await owner("owner@example.com", "Zawadi");
    await account("amina@example.com", "Amina");
    await account("customer@example.com", "Just a customer");
    const cashier = await createRole({ value: CASHIER, actorId: user.id });
    if (!cashier.ok) throw new Error("not created");
    await grantRole({ email: "amina@example.com", roleId: cashier.id, actor });

    expect(
      (await listStaff()).map((member) => [member.name, member.roles.map((role) => role.name)]),
    ).toEqual([
      ["Zawadi", [OWNER_ROLE]],
      ["Amina", ["Cashier"]],
    ]);
  });
});
