"use client";

import { useRef } from "react";

import { setProductWithdrawnAction } from "@/lib/admin/product-actions";

/**
 * Takes a product off the shop, after asking; or puts it back, without.
 *
 * Layered like Remove payment details: a real form, with a confirmation
 * <dialog> in front of it when JavaScript is available.
 */
export function WithdrawProduct({
  productId,
  withdrawn,
}: {
  productId: string;
  withdrawn: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  return (
    <section
      aria-labelledby="withdraw"
      className={`rounded-xl border p-5 ${withdrawn ? "border-border" : "border-red-200 dark:border-red-900"}`}
    >
      <h2 id="withdraw" className="font-semibold">
        {withdrawn ? "Put back on the shop" : "Take off the shop"}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {withdrawn
          ? "Buyers can find and buy it again, with the stock shown above."
          : "It disappears from the shop and from carts. Nothing is deleted: past orders keep it, and you can put it back."}
      </p>

      <form
        ref={form}
        action={setProductWithdrawnAction}
        onSubmit={(event) => {
          // Putting it back needs no second thought.
          if (withdrawn || confirmed.current) {
            confirmed.current = false;
            return;
          }
          event.preventDefault();
          dialog.current?.showModal();
        }}
        className="mt-4"
      >
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="withdrawn" value={withdrawn ? "false" : "true"} />
        <button
          type="submit"
          className={
            withdrawn
              ? "rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-muted"
              : "rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
          }
        >
          {withdrawn ? "Put back on the shop" : "Take off the shop"}
        </button>
      </form>

      <dialog
        ref={dialog}
        aria-labelledby="withdraw-title"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 id="withdraw-title" className="text-lg font-semibold">
          Take this product off the shop?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Nobody new can buy it. Buyers who have already paid can still be confirmed in Orders.
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
            Take it off
          </button>
        </div>
      </dialog>
    </section>
  );
}
