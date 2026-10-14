"use client";

import { useActionState } from "react";

import { type CheckFormState, checkPromptAction } from "@/lib/admin/order-actions";

/**
 * "Check M-Pesa status" for a prompt still waiting: asks Safaricom now. An
 * ordinary form, so it works without JavaScript; the page reloads with the
 * answer when there is one.
 */
export function CheckPrompt({ paymentId }: { paymentId: string }) {
  const [state, formAction, checking] = useActionState<CheckFormState, FormData>(
    checkPromptAction,
    {},
  );

  return (
    <form action={formAction} className="flex w-full flex-wrap items-center gap-3">
      <input type="hidden" name="paymentId" value={paymentId} />
      <button
        type="submit"
        disabled={checking}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-surface-muted disabled:opacity-60"
      >
        {checking ? "Asking M-Pesa…" : "Check M-Pesa status"}
      </button>
      {state.notice && (
        <p role="status" className="text-xs text-muted">
          {state.notice}
        </p>
      )}
    </form>
  );
}
