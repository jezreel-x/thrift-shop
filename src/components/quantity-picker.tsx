"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import type { LimitReason } from "@/lib/shop/availability";
import { LimitNote } from "./quantity-stepper";

/**
 * − n + for how many to add, before anything is in the cart. Lives inside the
 * add-to-cart form and posts its number as `quantity`.
 *
 * Without script the buttons do nothing and one is added, which the cart's
 * own stepper can then raise: the page never breaks, it just asks one click
 * more. When + stops, the same amber note as the cart says why.
 */
export function QuantityPicker({
  max,
  limitReason,
  label,
}: {
  max: number;
  limitReason: LimitReason;
  label: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const button =
    "flex size-9 items-center justify-center rounded-full transition hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-neutral-800";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="quantity" value={quantity} />
      <div
        role="group"
        aria-label={`How many ${label}`}
        className="inline-flex h-full items-center gap-1 rounded-full border border-neutral-300 p-0.5 dark:border-neutral-700"
      >
        <button
          type="button"
          disabled={quantity <= 1}
          onClick={() => setQuantity((current) => Math.max(1, current - 1))}
          aria-label={`One fewer ${label}`}
          className={button}
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <span aria-live="polite" className="min-w-6 text-center text-sm font-medium tabular-nums">
          {quantity}
        </span>
        <button
          type="button"
          disabled={quantity >= max}
          onClick={() => setQuantity((current) => Math.min(max, current + 1))}
          aria-label={quantity >= max ? `No more ${label} available` : `One more ${label}`}
          className={button}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
      {quantity >= max && <LimitNote reason={limitReason} max={max} />}
    </div>
  );
}
