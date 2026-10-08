import type { Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/generated/prisma/enums";
import { normaliseEmail } from "../auth/password";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";
import type { RoleInput } from "./role-form";

/**
 * Staff roles and who holds them.
 *
 * Revoking deletes the assignment row rather than flagging it inactive. A flag
 * would have to be remembered in every query that decides access, and the one
 * query that forgets would quietly let a revoked person back in. The history a
 * flag would have kept is in the audit log instead.
 */

/** The role the bootstrap creates: every permission, including future ones. */
export const OWNER_ROLE = "Owner";

export class UnknownUserError extends Error {
  constructor(email: string) {
    super(`No account for ${email}. Sign up on the site first, then run this again.`);
    this.name = "UnknownUserError";
  }
}

export class OwnerRoleNotSuperAdminError extends Error {
  constructor() {
    super(
      `A role named "${OWNER_ROLE}" exists but is not a super-admin role. ` +
        `Refusing to grant it as the owner, and refusing to escalate it silently.`,
    );
    this.name = "OwnerRoleNotSuperAdminError";
  }
}

/**
 * Makes an existing account the shop's owner.
 *
 * The one way in when nobody is staff yet: the Staff screen needs STAFF_MANAGE,
 * and on a fresh database nobody has it. Run from a script, so the audit entry
 * has no actor.
 *
 * Idempotent. Running it twice grants once and records once.
 */
export async function grantOwnerRole(
  email: string,
  actorId: string | null = null,
): Promise<{ userId: string; granted: boolean }> {
  const address = normaliseEmail(email);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: address }, select: { id: true } });
    if (!user) throw new UnknownUserError(address);

    const role = await tx.staffRole.upsert({
      where: { name: OWNER_ROLE },
      create: {
        name: OWNER_ROLE,
        description: "Runs the shop. Holds every permission, including ones added later.",
        isSuperAdmin: true,
      },
      update: {},
    });

    // Somebody may have created an ordinary role with this name on the Staff
    // screen. Upgrading it here would hand super-admin to everyone holding it.
    if (!role.isSuperAdmin) throw new OwnerRoleNotSuperAdminError();

    // skipDuplicates makes "already held" a count of zero rather than an error,
    // so the unique key decides it and nothing is looked up first.
    const { count } = await tx.staffRoleAssignment.createMany({
      data: [{ userId: user.id, roleId: role.id }],
      skipDuplicates: true,
    });

    if (count === 0) return { userId: user.id, granted: false };

    await recordAudit(tx, {
      actorId,
      action: "staff.grant-role",
      entityType: "User",
      entityId: user.id,
      after: { roleId: role.id, role: role.name },
    });

    return { userId: user.id, granted: true };
  });
}

/* ------------------------------------------------------- the Staff screen */

/**
 * The rules the Staff screen keeps, whoever is using it:
 *
 *   - Only an owner (a super-admin) may grant or revoke a super-admin role.
 *     STAFF_MANAGE alone would otherwise be a way to make yourself the owner.
 *   - The shop never loses its last owner. The check runs under a lock on the
 *     super-admin roles, so two owners removing each other at the same moment
 *     cannot both succeed.
 *   - Super-admin roles are fixed: they hold every permission, including ones
 *     added later, so there is nothing to edit, and they cannot be deleted or
 *     created here.
 *   - A role is deleted only when nobody holds it: removing people's access is
 *     done by revoking, one person at a time, where it can be seen.
 *
 * Every change is in the audit log with who made it.
 */

export type StaffRefusal =
  | "no-account"
  | "no-role"
  | "already-held"
  | "not-held"
  | "owner-only"
  | "last-owner"
  | "owner-role-fixed"
  | "role-in-use"
  | "name-taken";

export const STAFF_REFUSALS: Record<StaffRefusal, string> = {
  "no-account": "Nobody has an account with that email. Ask them to sign up on the shop first.",
  "no-role": "That role no longer exists. Reload.",
  "already-held": "They already have that role.",
  "not-held": "They no longer have that role. Reload.",
  "owner-only": "Only an owner can give or take away the owner role.",
  "last-owner": "The shop must always have an owner. Make someone else an owner first.",
  "owner-role-fixed": "The owner role always has every permission, so it can't be changed.",
  "role-in-use": "Someone still has this role. Take it away from them first.",
  "name-taken": "There's already a role with that name.",
};

export type StaffResult = { ok: true } | { ok: false; reason: StaffRefusal };

/** Who is acting, as far as these rules care. */
export type StaffActor = { userId: string; isSuperAdmin: boolean };

export async function grantRole(input: {
  email: string;
  roleId: string;
  actor: StaffActor;
}): Promise<StaffResult> {
  return prisma.$transaction(async (tx): Promise<StaffResult> => {
    const role = await tx.staffRole.findUnique({ where: { id: input.roleId } });
    if (!role) return { ok: false, reason: "no-role" };
    if (role.isSuperAdmin && !input.actor.isSuperAdmin) return { ok: false, reason: "owner-only" };

    const user = await tx.user.findUnique({
      where: { email: normaliseEmail(input.email) },
      select: { id: true },
    });
    if (!user) return { ok: false, reason: "no-account" };

    const { count } = await tx.staffRoleAssignment.createMany({
      data: [{ userId: user.id, roleId: role.id }],
      skipDuplicates: true,
    });
    if (count === 0) return { ok: false, reason: "already-held" };

    await recordAudit(tx, {
      actorId: input.actor.userId,
      action: "staff.grant-role",
      entityType: "User",
      entityId: user.id,
      after: { roleId: role.id, role: role.name },
    });

    return { ok: true };
  });
}

export async function revokeRole(input: {
  userId: string;
  roleId: string;
  actor: StaffActor;
}): Promise<StaffResult> {
  return prisma.$transaction(async (tx): Promise<StaffResult> => {
    // Serialises every revoke against the super-admin roles, so the count
    // below cannot be read by two revokes at once.
    await tx.$queryRaw`SELECT "id" FROM "StaffRole" WHERE "isSuperAdmin" = true FOR UPDATE`;

    const role = await tx.staffRole.findUnique({ where: { id: input.roleId } });
    if (!role) return { ok: false, reason: "no-role" };
    if (role.isSuperAdmin && !input.actor.isSuperAdmin) return { ok: false, reason: "owner-only" };

    const held = await tx.staffRoleAssignment.findUnique({
      where: { userId_roleId: { userId: input.userId, roleId: role.id } },
    });
    if (!held) return { ok: false, reason: "not-held" };

    if (role.isSuperAdmin) {
      const owners = await tx.staffRoleAssignment.findMany({
        where: { role: { isSuperAdmin: true } },
        select: { userId: true, roleId: true },
      });
      const remaining = new Set(
        owners
          .filter((owner) => !(owner.userId === input.userId && owner.roleId === role.id))
          .map((owner) => owner.userId),
      );
      if (remaining.size === 0) return { ok: false, reason: "last-owner" };
    }

    await tx.staffRoleAssignment.delete({
      where: { userId_roleId: { userId: input.userId, roleId: role.id } },
    });
    await recordAudit(tx, {
      actorId: input.actor.userId,
      action: "staff.revoke-role",
      entityType: "User",
      entityId: input.userId,
      before: { roleId: role.id, role: role.name },
    });

    return { ok: true };
  });
}

export async function createRole(input: {
  value: RoleInput;
  actorId: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: StaffRefusal }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const role = await tx.staffRole.create({
        data: {
          name: input.value.name,
          description: input.value.description,
          permissions: { create: input.value.permissions.map((permission) => ({ permission })) },
        },
      });
      await recordAudit(tx, {
        actorId: input.actorId,
        action: "staff.create-role",
        entityType: "StaffRole",
        entityId: role.id,
        after: snapshotRole(input.value),
      });

      return { ok: true as const, id: role.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    throw error;
  }
}

export async function updateRole(input: {
  roleId: string;
  value: RoleInput;
  actorId: string;
}): Promise<StaffResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<StaffResult> => {
      const role = await tx.staffRole.findUnique({
        where: { id: input.roleId },
        include: { permissions: { select: { permission: true } } },
      });
      if (!role) return { ok: false, reason: "no-role" };
      if (role.isSuperAdmin) return { ok: false, reason: "owner-role-fixed" };

      await tx.staffRole.update({
        where: { id: role.id },
        data: { name: input.value.name, description: input.value.description },
      });
      await tx.staffRolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.staffRolePermission.createMany({
        data: input.value.permissions.map((permission) => ({ roleId: role.id, permission })),
      });
      await recordAudit(tx, {
        actorId: input.actorId,
        action: "staff.update-role",
        entityType: "StaffRole",
        entityId: role.id,
        before: snapshotRole({
          name: role.name,
          description: role.description,
          permissions: role.permissions.map((row) => row.permission),
        }),
        after: snapshotRole(input.value),
      });

      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    throw error;
  }
}

export async function deleteRole(input: { roleId: string; actorId: string }): Promise<StaffResult> {
  return prisma.$transaction(async (tx): Promise<StaffResult> => {
    // Locked, so a grant cannot land between the check and the delete.
    const [role] = await tx.$queryRaw<{ id: string; name: string; isSuperAdmin: boolean }[]>`
      SELECT "id", "name", "isSuperAdmin" FROM "StaffRole" WHERE "id" = ${input.roleId} FOR UPDATE
    `;
    if (!role) return { ok: false, reason: "no-role" };
    if (role.isSuperAdmin) return { ok: false, reason: "owner-role-fixed" };
    if ((await tx.staffRoleAssignment.count({ where: { roleId: role.id } })) > 0) {
      return { ok: false, reason: "role-in-use" };
    }

    const permissions = await tx.staffRolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: true },
    });
    await tx.staffRole.delete({ where: { id: role.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "staff.delete-role",
      entityType: "StaffRole",
      entityId: role.id,
      before: { name: role.name, permissions: permissions.map((row) => row.permission).sort() },
    });

    return { ok: true };
  });
}

export type StaffMember = {
  id: string;
  name: string | null;
  email: string;
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
};

/** Everyone holding at least one role, owners first, then by name. */
export async function listStaff(): Promise<StaffMember[]> {
  const users = await prisma.user.findMany({
    where: { staffRoles: { some: {} } },
    select: {
      id: true,
      name: true,
      email: true,
      staffRoles: {
        orderBy: { role: { name: "asc" } },
        select: { role: { select: { id: true, name: true, isSuperAdmin: true } } },
      },
    },
  });

  const isOwner = (member: StaffMember) => member.roles.some((role) => role.isSuperAdmin);

  return users
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.staffRoles.map(({ role }) => role),
    }))
    .sort(
      (a, b) =>
        Number(isOwner(b)) - Number(isOwner(a)) ||
        (a.name ?? a.email).localeCompare(b.name ?? b.email),
    );
}

export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  isSuperAdmin: boolean;
  permissions: Permission[];
  members: number;
};

/** Every role, the owner role first, then by name. */
export async function listRoles(): Promise<RoleSummary[]> {
  const roles = await prisma.staffRole.findMany({
    orderBy: [{ isSuperAdmin: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isSuperAdmin: true,
      permissions: { select: { permission: true } },
      _count: { select: { assignments: true } },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSuperAdmin: role.isSuperAdmin,
    permissions: role.permissions.map((row) => row.permission),
    members: role._count.assignments,
  }));
}

export async function getRole(id: string): Promise<RoleSummary | null> {
  const role = await prisma.staffRole.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isSuperAdmin: true,
      permissions: { select: { permission: true } },
      _count: { select: { assignments: true } },
    },
  });
  if (!role) return null;

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSuperAdmin: role.isSuperAdmin,
    permissions: role.permissions.map((row) => row.permission),
    members: role._count.assignments,
  };
}

function snapshotRole(role: RoleInput): Prisma.InputJsonObject {
  return {
    name: role.name,
    description: role.description,
    permissions: [...role.permissions].sort(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
