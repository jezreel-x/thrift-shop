import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { getStaffAccess } from "./access";
import { OWNER_ROLE, OwnerRoleNotSuperAdminError, UnknownUserError, grantOwnerRole } from "./staff";

cleanDatabaseBetweenTests();

async function makeUser(email = "owner@example.com") {
  return db.user.create({
    data: { email, passwordHash: await hashPassword("a good passphrase") },
  });
}

describe("grantOwnerRole", () => {
  it("makes an existing account a super-admin and records who did it", async () => {
    const user = await makeUser();

    // Mixed case and whitespace, as somebody would type it into a terminal.
    const result = await grantOwnerRole("  Owner@Example.com ");

    expect(result).toEqual({ userId: user.id, granted: true });
    expect((await getStaffAccess(user.id))?.isSuperAdmin).toBe(true);

    const [entry] = await db.auditLog.findMany();
    expect(entry).toMatchObject({
      actorId: null,
      action: "staff.grant-role",
      entityType: "User",
      entityId: user.id,
      after: { role: OWNER_ROLE },
    });
  });

  it("grants once and records once however many times it runs", async () => {
    await makeUser();

    await grantOwnerRole("owner@example.com");
    const second = await grantOwnerRole("owner@example.com");

    expect(second.granted).toBe(false);
    expect(await db.staffRoleAssignment.count()).toBe(1);
    expect(await db.staffRole.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("shares one Owner role between two owners", async () => {
    await makeUser("first@example.com");
    await makeUser("second@example.com");

    await grantOwnerRole("first@example.com");
    await grantOwnerRole("second@example.com");

    expect(await db.staffRole.count()).toBe(1);
    expect(await db.staffRoleAssignment.count()).toBe(2);
  });

  it("refuses an address with no account, and changes nothing", async () => {
    await expect(grantOwnerRole("nobody@example.com")).rejects.toBeInstanceOf(UnknownUserError);

    expect(await db.staffRole.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("will not hand out an ordinary role that happens to be called Owner", async () => {
    // Upgrading it instead would silently make everyone holding it a super-admin.
    await makeUser();
    await db.staffRole.create({ data: { name: OWNER_ROLE, isSuperAdmin: false } });

    await expect(grantOwnerRole("owner@example.com")).rejects.toBeInstanceOf(
      OwnerRoleNotSuperAdminError,
    );

    expect(await db.staffRoleAssignment.count()).toBe(0);
    expect((await db.staffRole.findFirstOrThrow()).isSuperAdmin).toBe(false);
  });
});
