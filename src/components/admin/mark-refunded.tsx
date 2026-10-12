"use client";

import { useActionState } from "react";

import { type DecisionFormState, markRefundedAction } from "@/lib/admin/order-actions";

/**
 * Records that the shop sent a buyer's money back. An ordinary form: works
 * without JavaScript, and a refusal appears beside the button.
 */
export function MarkRefunded({ orderId }: { orderId: string }) {
  const [state, formAction, saving] = useActionState<DecisionFormState, FormData>(
    markRefundedAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="refund-note" className="text-sm font-medium">
        How it was sent back <span className="font-normal text-muted">(the buyer sees this)</span>
      </label>
      <input
        id="refund-note"
        name="note"
        required
        minLength={3}
        maxLength={300}
        placeholder="e.g. Refunded on M-Pesa, code SGK7T2XQ1B"
        className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none"
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : "Mark refunded"}
        </button>
      </div>
    </form>
  );
}
