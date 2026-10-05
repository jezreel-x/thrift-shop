"use client";

import { useActionState } from "react";

import { type WhatsAppFormState, saveWhatsAppAction } from "@/lib/admin/settings-actions";

/** The number "Order on WhatsApp" opens. An ordinary form; works without JavaScript. */
export function WhatsAppSettingsForm({ initial }: { initial: string }) {
  const [state, formAction, saving] = useActionState<WhatsAppFormState, FormData>(
    saveWhatsAppAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      {state.saved && (
        <p
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          {state.saved === "changed"
            ? "Saved. Buyers' order messages go to this number."
            : "Nothing changed: this is already the saved number."}
        </p>
      )}
      <label htmlFor="whatsappNumber" className="text-sm font-medium">
        Shop WhatsApp number
      </label>
      <input
        id="whatsappNumber"
        name="whatsappNumber"
        defaultValue={initial}
        inputMode="tel"
        autoComplete="off"
        placeholder="0712 345 678"
        className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none ${
          state.error ? "border-red-400" : "border-border focus:border-foreground"
        }`}
      />
      {state.error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : (
        <p className="text-xs text-muted">
          Where &ldquo;Order on WhatsApp&rdquo; sends buyers, with their order already written.
          Leave it empty to hide the button.
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : "Save WhatsApp number"}
        </button>
      </div>
    </form>
  );
}
