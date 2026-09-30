import { normaliseEmail } from "../auth/password";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";

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
