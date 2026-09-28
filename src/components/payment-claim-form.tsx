"use client";

import { useActionState } from "react";

import { type ClaimFormState, claimPaymentAction } from "@/lib/checkout-actions";

/**
 * Where the buyer types the M-Pesa code from their confirmation SMS.
 *
 * A client component only so the error appears in place. The form is an
 * ordinary one and submits without JavaScript.
 */
export function PaymentClaimForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<ClaimFormState, FormData>(
    claimPaymentAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="orderId" value={orderId} />

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="mpesaCode" className="mb-1.5 block text-sm font-medium">
          M-Pesa confirmation code
        </label>
        <input
          id="mpesaCode"
          name="mpesaCode"
          required
          maxLength={10}
          // Safaricom writes the code in capitals; matching that makes it easier
          // to compare against the SMS on screen.
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="SGH7XKL2M9"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 font-mono tracking-wider uppercase focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          The code at the start of your M-Pesa message, like{" "}
          <span className="font-mono">SGH7XKL2M9</span>.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Sending…" : "I have paid"}
      </button>
    </form>
  );
}
