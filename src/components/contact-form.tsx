"use client";

import { useActionState } from "react";

import { type ContactFormState, saveContactAction } from "@/lib/shop/checkout-actions";

/**
 * Asked once, before anything is reserved.
 *
 * Before rather than after, so the fifteen-minute hold is not spent typing —
 * and saved to the account, so a second order asks for nothing.
 */
export function ContactForm({ name }: { name: string | null }) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(
    saveContactAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={name ?? ""}
          autoComplete="name"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          required
          // Opens the numeric keypad on a phone without rejecting "+" or spaces,
          // which type="tel" allows and people use.
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0712 345 678"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          How we confirm your payment and arrange delivery.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Saving…" : "Continue to payment"}
      </button>
    </form>
  );
}
