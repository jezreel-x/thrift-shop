import { beforeEach, describe, expect, it, vi } from "vitest";

import { Permission } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { getStaffAccess, requirePermission, requireStaff } from "./access";

/**
 * The guard reads the signed-in user from a cookie, which only exists inside a
 * request. Stand in for that one step; everything below it — the role lookup,
 * the union, the refusal — runs for real against the database.
 */
let signedIn: SessionUser | null = null;

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async (returnTo: string) => {
    if (!signedIn) throw Object.assign(new Error("redirect"), { returnTo });
    return signedIn;
  },
}));

cleanDatabaseBetweenTests();

beforeEach(() => {
  signedIn = null;
});

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

async function makeUser(email = "wanjiru@example.com"): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword("a good passphrase") },
  });

  return { id: user.id, email: user.email, name: null, phone: null };
}

async function makeRole(name: string, permissions: Permission[], isSuperAdmin = false) {
  return db.staffRole.create({
    data: {
      name,
      isSuperAdmin,
      permissions: { create: permissions.map((permission) => ({ permission })) },
    },
  });
}

async function assign(userId: string, roleId: string) {
  await db.staffRoleAssignment.create({ data: { userId, roleId } });
}

describe("getStaffAccess", () => {
  it("is null for a customer with no roles", async () => {
    const user = await makeUser();

    expect(await getStaffAccess(user.id)).toBeNull();
  });

  it("unions the permissions of every role held", async () => {
    const user = await makeUser();
    const packer = await makeRole("Packer", [Permission.ORDERS_VIEW, Permission.ORDERS_FULFIL]);
    const cashier = await makeRole("Cashier", [
      Permission.ORDERS_VIEW,
      Permission.ORDERS_CONFIRM_PAYMENT,
    ]);
    await assign(user.id, packer.id);
    await assign(user.id, cashier.id);

    const access = await getStaffAccess(user.id);

    expect(access?.roles).toEqual(["Cashier", "Packer"]);
    expect([...(access?.permissions ?? [])].sort()).toEqual(
      [Permission.ORDERS_CONFIRM_PAYMENT, Permission.ORDERS_FULFIL, Permission.ORDERS_VIEW].sort(),
    );
  });

  it("does not leak one person's roles to another", async () => {
    const staff = await makeUser();
    const customer = await makeUser("customer@example.com");
    const owner = await makeRole("Owner", [], true);
    await assign(staff.id, owner.id);

    expect(await getStaffAccess(customer.id)).toBeNull();
  });
});

describe("requirePermission", () => {
  it("sends somebody signed out to sign in, and back here afterwards", async () => {
    await expect(requirePermission(Permission.ORDERS_VIEW, "/admin/orders")).rejects.toMatchObject({
      returnTo: "/admin/orders",
    });
  });

  it("answers a customer with a 404, so the admin area does not announce itself", async () => {
    signedIn = await makeUser();

    await expect(requireStaff()).rejects.toMatchObject({ digest: NOT_FOUND });
    await expect(requirePermission(Permission.ORDERS_VIEW)).rejects.toMatchObject({
      digest: NOT_FOUND,
    });
  });

  it("refuses staff a permission their roles do not grant", async () => {
    signedIn = await makeUser();
    const packer = await makeRole("Packer", [Permission.ORDERS_VIEW, Permission.ORDERS_FULFIL]);
    await assign(signedIn.id, packer.id);

    await expect(requirePermission(Permission.SETTINGS_EDIT)).rejects.toMatchObject({
      digest: NOT_FOUND,
    });
  });

  it("lets staff through with what their roles grant", async () => {
    signedIn = await makeUser();
    const packer = await makeRole("Packer", [Permission.ORDERS_VIEW, Permission.ORDERS_FULFIL]);
    await assign(signedIn.id, packer.id);

    const staff = await requirePermission(Permission.ORDERS_FULFIL);

    expect(staff.user.id).toBe(signedIn.id);
  });

  it("stops a revoked person on their very next request", async () => {
    // Permissions are read per request, not carried in the session, so there
    // is no week-long window in which a removed Cashier can still confirm.
    signedIn = await makeUser();
    const cashier = await makeRole("Cashier", [Permission.ORDERS_CONFIRM_PAYMENT]);
    await assign(signedIn.id, cashier.id);
    await requirePermission(Permission.ORDERS_CONFIRM_PAYMENT);

    await db.staffRoleAssignment.deleteMany({ where: { userId: signedIn.id } });

    await expect(requirePermission(Permission.ORDERS_CONFIRM_PAYMENT)).rejects.toMatchObject({
      digest: NOT_FOUND,
    });
  });

  it("stops everyone holding a role the moment a permission is unticked", async () => {
    signedIn = await makeUser();
    const cashier = await makeRole("Cashier", [Permission.ORDERS_CONFIRM_PAYMENT]);
    await assign(signedIn.id, cashier.id);

    await db.staffRolePermission.deleteMany({ where: { roleId: cashier.id } });

    await expect(requirePermission(Permission.ORDERS_CONFIRM_PAYMENT)).rejects.toMatchObject({
      digest: NOT_FOUND,
    });
  });
});
