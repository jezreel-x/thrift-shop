"use client";

import { useRef } from "react";

import { clearPaymentSettingsAction } from "@/lib/admin/settings-actions";

/**
 * Takes the payment details down, after asking.
 *
 * The same layering as Sign out: a real form posting to the action, with a
 * confirmation <dialog> in front of it when JavaScript is available. Without
 * script it removes directly, so the button never does nothing.
 */
export function RemovePaymentDetails() {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  return (
    <section
      aria-labelledby="remove-payment"
      className="mt-12 rounded-xl border border-red-200 p-5 dark:border-red-900"
    >
      <h2 id="remove-payment" className="font-semibold">
        Remove payment details
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Checkout will say payment details have not been set up, and nobody can pay online until new
        details are saved. Use this when the shop is not ready to take money, or when a sample shop
        should not show anybody&apos;s real number.
      </p>

      <form
        ref={form}
        action={clearPaymentSettingsAction}
        onSubmit={(event) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          event.preventDefault();
          dialog.current?.showModal();
        }}
        className="mt-4"
      >
        <button
          type="submit"
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          Remove payment details
        </button>
      </form>

      <dialog
        ref={dialog}
        aria-labelledby="remove-payment-title"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 id="remove-payment-title" className="text-lg font-semibold">
          Remove payment details?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Buyers will not be able to pay online until you save new details. Orders already waiting
          for a payment check are not affected.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              confirmed.current = true;
              dialog.current?.close();
              form.current?.requestSubmit();
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Remove
          </button>
        </div>
      </dialog>
    </section>
  );
}
