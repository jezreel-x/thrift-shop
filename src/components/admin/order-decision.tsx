"use client";

import { useActionState } from "react";

import {
  type DecisionFormState,
  confirmOrderAction,
  rejectOrderAction,
} from "@/lib/admin/order-actions";

/**
 * Confirm or reject a claimed payment.
 *
 * A client component only so a refusal — "someone already decided this", "a
 * hold ran out" — appears beside the button that caused it. Both are ordinary
 * forms and submit without JavaScript.
 */
export function OrderDecision({
  orderId,
  total,
  canConfirm,
}: {
  orderId: string;
  total: string;
  /** False when a hold has already run out: confirming is certain to fail, so it is not offered. */
  canConfirm: boolean;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<DecisionFormState, FormData>(
    confirmOrderAction,
    {},
  );
  const [rejectState, rejectAction, rejecting] = useActionState<DecisionFormState, FormData>(
    rejectOrderAction,
    {},
  );
  const busy = confirming || rejecting;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {canConfirm && (
        <form
          action={confirmAction}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5"
        >
          <input type="hidden" name="orderId" value={orderId} />
          <div>
            <h3 className="font-medium">Payment arrived</h3>
            <p className="mt-1 text-sm text-muted">
              You found this payment of {total} in your own M-Pesa records. Every item is marked
              sold.
            </p>
          </div>
          {confirmState.error && <Refusal message={confirmState.error} />}
          <label htmlFor="note" className="text-sm font-medium">
            Note <span className="font-normal text-muted">(optional, staff only)</span>
          </label>
          <input
            id="note"
            name="note"
            maxLength={300}
            placeholder="e.g. matched at 14:05"
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="mt-auto rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-800 disabled:opacity-60"
          >
            {confirming ? "Confirming…" : "Confirm payment"}
          </button>
        </form>
      )}

      <form
        action={rejectAction}
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <div>
          <h3 className="font-medium">Payment not found</h3>
          <p className="mt-1 text-sm text-muted">
            No matching message, or the amount is wrong. The items go back on sale.
          </p>
        </div>
        {rejectState.error && <Refusal message={rejectState.error} />}
        <label htmlFor="reason" className="text-sm font-medium">
          Reason <span className="font-normal text-muted">(the buyer sees this)</span>
        </label>
        <input
          id="reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="e.g. No payment with this code. Please check and order again."
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-auto rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          {rejecting ? "Rejecting…" : "Reject payment"}
        </button>
      </form>
    </div>
  );
}

function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </p>
  );
}
