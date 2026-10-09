"use client";

import { startTransition, useActionState } from "react";

import { type ShopRulesFormState, saveShopRulesAction } from "@/lib/admin/settings-actions";

/**
 * The most of one item per order, or no limit.
 *
 * With script it submits by hand rather than through `action`: React resets a
 * form after its action runs, and a refused save would put back the old number.
 */
export function ShopRulesForm({ initial }: { initial: number | null }) {
  const [state, formAction, saving] = useActionState<ShopRulesFormState, FormData>(
    saveShopRulesAction,
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
      // Disables the number while "No limit" is ticked, by CSS alone.
      className="group flex max-w-xl flex-col gap-4"
    >
      {state.saved && (
        <p
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          {state.saved === "changed"
            ? "Saved. Product pages and carts use it from now on."
            : "Nothing changed."}
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Most of one item per order</legend>
        <p className="text-xs text-muted">
          One item is one colour and size. Checkout holds what a buyer is paying for while you check
          the payment, so a limit stops one buyer holding a whole size for a day. Raise it if you
          sell in bulk.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <input
            name="maxPerItem"
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            defaultValue={initial ?? 5}
            aria-label="Most of one item per order"
            className={`w-24 rounded-lg border bg-transparent px-3 py-2 text-sm tabular-nums group-has-[#noLimit:checked]:opacity-40 focus:border-foreground focus:outline-none ${
              state.error ? "border-red-400" : "border-border"
            }`}
          />
          <label htmlFor="noLimit" className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              id="noLimit"
              name="noLimit"
              type="checkbox"
              defaultChecked={initial === null}
              className="size-4"
            />
            No limit
          </label>
        </div>
        {state.error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {state.error}
          </p>
        )}
      </fieldset>

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
    </form>
  );
}
