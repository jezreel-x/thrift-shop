import type { Prisma } from "@/generated/prisma/client";

/**
 * The audit log: who changed what, and what it was before.
 *
 * Append-only by convention — nothing in the application updates or deletes a
 * row. It is also the history that hard deletes elsewhere give up: revoking a
 * role removes the assignment, and this is where "she was a Cashier until
 * March" survives.
 */

/**
 * Every action the log can record.
 *
 * A closed list rather than free text, so a typo is a compile error instead of
 * a category nobody ever filters for. Grows as each admin feature lands.
 */
export type AuditAction =
  | "staff.grant-role"
  | "order.confirm-payment"
  | "order.reject-payment"
  | "settings.update-payment"
  | "settings.clear-payment"
  | "settings.update-whatsapp"
  | "settings.update-delivery"
  | "product.create"
  | "product.update"
  | "product.withdraw"
  | "product.restore"
  | "product.add-photo"
  | "product.update-photo"
  | "product.reorder-photos"
  | "product.remove-photo"
  | "stock.sold-elsewhere"
  | "stock.hold"
  | "stock.sell-hold"
  | "stock.release-hold";

export type AuditEntityType = "User" | "StaffRole" | "Order" | "Product" | "ShopSettings";

export type AuditEntry = {
  /** Null when a script did it rather than a signed-in person. */
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

/**
 * Records one entry, inside the caller's transaction.
 *
 * Takes the transaction client rather than using the global one, and that is
 * the point: the entry commits or rolls back with the change it describes.
 * Written separately, a failed change could leave a record of something that
 * never happened, or a committed change could go unrecorded because the log
 * write failed after it.
 */
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
    },
  });
}
