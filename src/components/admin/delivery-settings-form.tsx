"use client";

import { Plus, X } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";

import {
  type DeliverySettingsFormState,
  saveDeliverySettingsAction,
} from "@/lib/admin/settings-actions";

type Row = { key: string; id: string | null; name: string; fee: string };

const INPUT =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none";

/**
 * Pickup point and delivery areas with their fees, as checkout offers them.
 *
 * Submitted by hand rather than through `action`, like the product form:
 * React resets a form after its action runs, which would wipe a list being
 * edited whenever a save is refused.
 */
export function DeliverySettingsForm({
  initial,
}: {
  initial: { pickupAddress: string; areas: { id: string; name: string; fee: string }[] };
}) {
  const [state, formAction, saving] = useActionState<DeliverySettingsFormState, FormData>(
    saveDeliverySettingsAction,
    {},
  );
  const errors = state.errors ?? {};
  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.areas.length > 0
      ? initial.areas.map((area) => ({ key: area.id, ...area }))
      : [{ key: "new-0", id: null, name: "", fee: "" }],
  );

  // After a save the rows take the saved list, so new areas carry their ids
  // and a second save updates them rather than adding them again. Adjusted
  // during render, React's pattern for state that follows a result.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.areas) {
      setRows(
        state.areas.length > 0
          ? state.areas.map((area) => ({ key: area.id, ...area }))
          : [{ key: "new-0", id: null, name: "", fee: "" }],
      );
    }
  }

  function update(key: string, change: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex max-w-xl flex-col gap-6"
    >
      <input
        type="hidden"
        name="areas"
        value={JSON.stringify(rows.map(({ id, name, fee }) => ({ id, name, fee })))}
      />

      {state.saved && (
        <p
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          {state.saved === "changed"
            ? "Saved. Checkout offers these from now on; orders already placed keep their fee."
            : "Nothing changed."}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pickupAddress" className="text-sm font-medium">
          Pickup point
        </label>
        <input
          id="pickupAddress"
          name="pickupAddress"
          defaultValue={initial.pickupAddress}
          maxLength={120}
          placeholder="HH Towers, 4th floor, Shop 12"
          className={`${INPUT} ${errors.pickupAddress ? "border-red-400" : "border-border"}`}
        />
        <p
          className={`text-xs ${errors.pickupAddress ? "text-red-700 dark:text-red-300" : "text-muted"}`}
        >
          {errors.pickupAddress ??
            "Where buyers collect orders, free. Leave empty if you don't offer pickup."}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Delivery areas</legend>
        <p className="mb-1 text-xs text-muted">
          Buyers pick one at checkout and add a landmark; the fee is added to what they pay. Leave
          the list empty if you don&apos;t deliver.
        </p>

        <div className="grid grid-cols-[1fr_7rem_auto] gap-2 text-[11px] font-medium tracking-wider text-muted uppercase">
          <span>Area</span>
          <span>Fee (KSh)</span>
          <span className="sr-only">Remove</span>
        </div>
        {rows.map((row, index) => {
          const error = errors[`area:${index}`];

          return (
            <div key={row.key}>
              <div className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                <input
                  aria-label={`Area ${index + 1}`}
                  value={row.name}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  maxLength={40}
                  placeholder={index === 0 ? "Westlands" : ""}
                  className={`${INPUT} ${error ? "border-red-400" : "border-border"}`}
                />
                <input
                  aria-label={`Fee for ${row.name || `area ${index + 1}`}`}
                  value={row.fee}
                  onChange={(event) => update(row.key, { fee: event.target.value })}
                  inputMode="decimal"
                  placeholder={index === 0 ? "250" : ""}
                  className={`${INPUT} tabular-nums ${error ? "border-red-400" : "border-border"}`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) => current.filter((item) => item.key !== row.key))
                  }
                  aria-label={`Remove ${row.name || "this area"}`}
                  className="rounded-md p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
            </div>
          );
        })}
        {errors.areas && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {errors.areas}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            nextKey.current += 1;
            setRows((current) => [
              ...current,
              { key: `new-${nextKey.current}`, id: null, name: "", fee: "" },
            ]);
          }}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-muted"
        >
          <Plus aria-hidden className="size-4" />
          Add area
        </button>
      </fieldset>

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : "Save delivery"}
        </button>
      </div>
    </form>
  );
}
