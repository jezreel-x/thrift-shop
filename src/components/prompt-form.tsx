"use client";

import { startTransition, useActionState } from "react";

import { type PromptFormState, requestPromptAction } from "@/lib/shop/checkout-actions";

/**
 * "Send M-Pesa prompt": the buyer's number, prefilled with the one on the
 * order and changeable (paying from a partner's line is common).
 *
 * Submitted through startTransition so a refusal ("that isn't a Kenyan number")
 * leaves what they typed in place: React resets a form after its action runs.
 * The action attribute stays, so it still works without JavaScript.
 */
export function PromptForm({
  orderId,
  phone,
  total,
}: {
  orderId: string;
  /** Shown as the buyer writes it, 0712 345 678. */
  phone: string;
  /** "KSh 1,500" */
  total: string;
}) {
  const [state, formAction, sending] = useActionState<PromptFormState, FormData>(
    requestPromptAction,
    {},
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-4"
    >
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
        <label htmlFor="prompt-phone" className="mb-1.5 block text-sm font-medium">
          M-Pesa number
        </label>
        <input
          id="prompt-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={phone}
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 tabular-nums focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          We&rsquo;ll send a prompt for {total} to this phone. Enter your M-Pesa PIN when it
          appears.
        </p>
      </div>

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {sending ? "Sending the prompt…" : "Send M-Pesa prompt"}
      </button>
    </form>
  );
}
