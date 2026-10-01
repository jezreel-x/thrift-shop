"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "./access";
import { type DecisionResult, confirmOrder, rejectOrder } from "./orders";

export type DecisionFormState = { error?: string };

const MAX_NOTE = 300;
const MIN_REASON = 3;

/**
 * Confirm a payment. Requires ORDERS_CONFIRM_PAYMENT: seeing the queue is not
 * the same as being trusted to say money has arrived.
 *
 * Redirects back to the order on success, so a refresh shows the outcome
 * rather than offering to submit the decision again.
 */
export async function confirmOrderAction(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const { user } = await requirePermission(Permission.ORDERS_CONFIRM_PAYMENT);

  const orderId = String(formData.get("orderId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, MAX_NOTE);

  const result = await confirmOrder({ orderId, actorId: user.id, note });
  if (!result.ok) return { error: refusalMessage(result) };

  showDecided(result.reference);
}

/** Reject a payment, with the reason the buyer will be shown. */
export async function rejectOrderAction(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const { user } = await requirePermission(Permission.ORDERS_CONFIRM_PAYMENT);

  const orderId = String(formData.get("orderId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (reason.length < MIN_REASON) {
    return { error: "Say why, in a few words. The buyer sees this on their order." };
  }
  if (reason.length > MAX_NOTE) {
    return { error: `Keep the reason under ${MAX_NOTE} characters.` };
  }

  const result = await rejectOrder({ orderId, actorId: user.id, reason });
  if (!result.ok) return { error: refusalMessage(result) };

  showDecided(result.reference);
}

/**
 * After a decision: re-render the admin layout as well as the page, then show
 * the order. Without the revalidation the redirect keeps the layout already on
 * screen, and the menu goes on counting the order just decided.
 */
function showDecided(reference: string): never {
  revalidatePath("/admin", "layout");
  redirect(`/admin/orders/${reference}`);
}

function refusalMessage(result: Extract<DecisionResult, { ok: false }>): string {
  switch (result.reason) {
    case "not-found":
      return "This order no longer exists.";
    case "already-decided":
      return "Someone has already decided this order. Reload the page to see what happened.";
    case "hold-lapsed": {
      const items = result.titles?.join(", ") ?? "An item";
      return (
        `The hold on ${items} ran out before this was confirmed, so it may have been sold to ` +
        `someone else. Nothing was changed. If the money arrived, contact the buyer about a ` +
        `refund, then reject the order.`
      );
    }
  }
}
