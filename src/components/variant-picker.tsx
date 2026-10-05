import Link from "next/link";

import type { Choice } from "@/lib/shop/variant-choice";

/**
 * Colour swatches and size buttons, as links.
 *
 * Each choice is a URL (?option1=khaki&option2=32), so picking works with no
 * JavaScript, the page renders the right photos, price and stock on the server,
 * and "Khaki in 32" can be sent to someone as a link. `scroll={false}` keeps the
 * buyer where they are on the page while it updates.
 *
 * A sold-out size stays visible, crossed out: it exists, it is gone. Hiding it
 * would leave buyers wondering whether it was ever made.
 */
export function VariantPicker({
  pathname,
  choice,
  option1Name,
  option2Name,
}: {
  pathname: string;
  choice: Choice;
  option1Name: string | null;
  option2Name: string | null;
}) {
  const selectedSwatch = choice.swatches.find((swatch) => swatch.selected);
  const selectedSize = choice.option2.find((size) => size.selected);
  const href = (option1: string | undefined, option2: string | undefined) => {
    const params = new URLSearchParams();
    if (option1) params.set("option1", option1);
    if (option2) params.set("option2", option2);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <div className="mt-6 space-y-5">
      {choice.swatches.length > 0 && (
        <fieldset>
          <legend className="text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              {option1Name ?? "Colour"}:
            </span>{" "}
            <span className="font-medium">{selectedSwatch?.name}</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {choice.swatches.map((swatch) => (
              <Link
                key={swatch.id}
                href={href(swatch.slug, selectedSize?.value)}
                scroll={false}
                aria-current={swatch.selected ? "true" : undefined}
                aria-label={`${swatch.name}${swatch.soldOut ? ", sold out" : ""}`}
                title={swatch.name}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                  swatch.selected
                    ? "border-neutral-900 dark:border-neutral-100"
                    : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700"
                } ${swatch.soldOut ? "text-neutral-400 line-through dark:text-neutral-600" : ""}`}
              >
                {swatch.hex && (
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-black/10 dark:border-white/20"
                    style={{ backgroundColor: swatch.hex }}
                  />
                )}
                {swatch.name}
              </Link>
            ))}
          </div>
        </fieldset>
      )}

      {choice.option2.length > 1 && (
        <fieldset>
          <legend className="text-sm text-neutral-500 dark:text-neutral-400">
            {option2Name ?? "Size"}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {choice.option2.map((size) => (
              <Link
                key={size.value}
                href={href(selectedSwatch?.slug, size.value)}
                scroll={false}
                aria-current={size.selected ? "true" : undefined}
                aria-label={`${size.value}${size.soldOut ? ", sold out" : ""}`}
                className={`min-w-11 rounded-lg border px-3 py-2 text-center text-sm transition ${
                  size.selected
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700"
                } ${
                  size.soldOut
                    ? "text-neutral-400 line-through decoration-neutral-400 dark:text-neutral-600"
                    : ""
                }`}
              >
                {size.value}
              </Link>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
