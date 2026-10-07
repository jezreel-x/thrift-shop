"use client";

import { startTransition, useActionState } from "react";

import { type DeliveryFormState, saveDeliveryAction } from "@/lib/shop/checkout-actions";
import type { DeliveryOptions } from "@/lib/shop/delivery";
import { formatPrice } from "@/lib/money";

const INPUT =
  "w-full rounded-lg border bg-transparent px-3 py-2.5 focus:border-neutral-900 focus:outline-none dark:focus:border-neutral-100";

const OPTION =
  "flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-neutral-300 px-4 py-3 transition has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-50 dark:border-neutral-700 dark:has-[:checked]:border-neutral-100 dark:has-[:checked]:bg-neutral-900";

/**
 * Pickup or delivery, asked before anything is reserved.
 *
 * The delivery fields show only while Delivery is chosen, by CSS alone
 * (`group-has-[…:checked]`), so the form works the same without JavaScript.
 */
export function DeliveryForm({
  options,
  initial,
}: {
  options: DeliveryOptions;
  initial: { fulfilment: string; area: string; address: string; phone: string };
}) {
  const [state, formAction, pending] = useActionState<DeliveryFormState, FormData>(
    saveDeliveryAction,
    {},
  );
  const errors = state.errors ?? {};
  const onlyDelivery = !options.pickupAddress;
  const chosen = onlyDelivery ? "DELIVERY" : initial.fulfilment || "PICKUP";

  return (
    <form
      action={formAction}
      // With JavaScript, submitted by hand: React resets a form after its
      // action runs, and a refused submit would flip the choice back to
      // pickup under the buyer's feet. Without it, the plain post above.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="group space-y-5"
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">How would you like it?</legend>

        {options.pickupAddress && (
          <label className={OPTION}>
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="fulfilment"
                value="PICKUP"
                defaultChecked={chosen === "PICKUP"}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Collect from the shop</span>
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                  {options.pickupAddress}
                </span>
              </span>
            </span>
            <span className="text-sm font-medium">Free</span>
          </label>
        )}

        {options.areas.length > 0 && (
          <label className={OPTION}>
            <span className="flex items-start gap-3">
              <input
                id="fulfilment-delivery"
                type="radio"
                name="fulfilment"
                value="DELIVERY"
                defaultChecked={chosen === "DELIVERY"}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Delivery</span>
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                  The fee depends on your area.
                </span>
              </span>
            </span>
          </label>
        )}
        {errors.fulfilment && <FieldError message={errors.fulfilment} />}
      </fieldset>

      {options.areas.length > 0 && (
        <div className="hidden space-y-4 group-has-[#fulfilment-delivery:checked]:block">
          <div>
            <label htmlFor="area" className="mb-1.5 block text-sm font-medium">
              Area
            </label>
            <select
              id="area"
              name="area"
              defaultValue={initial.area}
              className={`${INPUT} ${errors.area ? "border-red-400" : "border-neutral-300 dark:border-neutral-700"} bg-white dark:bg-neutral-950`}
            >
              <option value="">Choose your area…</option>
              {options.areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name} — {area.feeCents === 0 ? "free" : formatPrice(area.feeCents)}
                </option>
              ))}
            </select>
            {errors.area && <FieldError message={errors.area} />}
          </div>

          <div>
            <label htmlFor="address" className="mb-1.5 block text-sm font-medium">
              Building, street or landmark
            </label>
            <textarea
              id="address"
              name="address"
              rows={2}
              maxLength={200}
              defaultValue={initial.address}
              autoComplete="street-address"
              placeholder="Kindaruma Rd, Blue Gate apartments, opposite Naivas"
              className={`${INPUT} ${errors.address ? "border-red-400" : "border-neutral-300 dark:border-neutral-700"}`}
            />
            {errors.address && <FieldError message={errors.address} />}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
              Phone for the rider
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={initial.phone}
              placeholder="0712 345 678"
              className={`${INPUT} ${errors.phone ? "border-red-400" : "border-neutral-300 dark:border-neutral-700"}`}
            />
            {errors.phone ? (
              <FieldError message={errors.phone} />
            ) : (
              <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                Whoever will receive it, if that isn&apos;t you.
              </p>
            )}
          </div>
        </div>
      )}

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

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-1.5 text-sm text-red-700 dark:text-red-300">
      {message}
    </p>
  );
}
