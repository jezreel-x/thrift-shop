"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PaymentStatus, Permission, SettledVia } from "@/generated/prisma/enums";
import { checkPrompt } from "../payments/stk";
import { prisma } from "../prisma";
import { requirePermission } from "./access";
import { type DecisionResult, confirmOrder, markRefunded, rejectOrder } from "./orders";

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
  }
}

export type CheckFormState = { notice?: string };

/**
 * "Check M-Pesa status": asks Safaricom how a prompt ended, now, rather than
 * waiting for the callback or the daily housekeeping. Settles on Safaricom's
 * answer, exactly as they do; staff can't decide a prompt by hand.
 */
export async function checkPromptAction(
  _previous: CheckFormState,
  formData: FormData,
): Promise<CheckFormState> {
  const { user } = await requirePermission(Permission.ORDERS_CONFIRM_PAYMENT);

  const paymentId = String(formData.get("paymentId") ?? "");
  const result = await checkPrompt(paymentId, SettledVia.STAFF_CHECK, { actorId: user.id });

  if (!result.changed) {
    return {
      notice:
        result.status === PaymentStatus.PENDING
          ? "M-Pesa hasn't said how this prompt ended yet. Try again in a minute."
          : "This prompt has already been settled. Reload the page to see how.",
    };
  }

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { order: { select: { reference: true } } },
  });
  showDecided(payment.order.reference);
}

/**
 * Records that a buyer's money has been sent back. Same permission as
 * confirming: both are statements about money that only trusted staff make.
 */
export async function markRefundedAction(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const { user } = await requirePermission(Permission.ORDERS_CONFIRM_PAYMENT);

  const orderId = String(formData.get("orderId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < MIN_REASON) {
    return { error: "Say how it was sent back, such as the M-Pesa reversal code." };
  }
  if (note.length > MAX_NOTE) return { error: `Keep it under ${MAX_NOTE} characters.` };

  const result = await markRefunded({ orderId, actorId: user.id, note });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "This order no longer exists."
          : "This order isn't waiting for a refund. Reload the page to see what happened.",
    };
  }

  showDecided(result.reference);
}
