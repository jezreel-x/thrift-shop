import Link from "next/link";

import { Category, Condition, Gender } from "@/generated/prisma/enums";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  GENDERS,
  GENDER_LABELS,
  allSizes,
} from "@/lib/catalogue";
import { PARAM, SORTS, SORT_LABELS, hasActiveFilters } from "@/lib/product-search-params";
import type { ProductQuery } from "@/lib/product-search-params";

/**
 * The catalogue's filters, as an ordinary GET form.
 *
 * No client JavaScript: submitting navigates to a new URL, the server renders
 * the filtered page, and the result is bookmarkable and crawlable. On a cheap
 * phone over mobile data that is a real advantage — the filters work before any
 * bundle has downloaded, and there is no bundle to download.
 *
 * The cost is an explicit Apply rather than filtering as you tick. On a slow
 * connection that is arguably the better trade anyway: one round trip instead of
 * one per checkbox.
 */
export function ProductFilters({ query }: { query: ProductQuery }) {
  const active = hasActiveFilters(query.filters);

  return (
    <>
      {/* Phones: collapsed behind a summary so the grid stays above the fold. */}
      <details className="lg:hidden">
        <summary className="cursor-pointer rounded-lg border border-neutral-200 px-4 py-3 text-sm font-medium select-none dark:border-neutral-800">
          Filters{active ? " · on" : ""}
        </summary>
        <div className="mt-4">
          <FilterForm query={query} idPrefix="m" />
        </div>
      </details>

      {/* Wider screens: always visible, beside the grid. */}
      <div className="hidden lg:block">
        <FilterForm query={query} idPrefix="d" />
      </div>
    </>
  );
}

/**
 * `idPrefix` exists because this form is rendered twice — once for each
 * breakpoint — and duplicate element ids would break every label's association
 * with its checkbox, which is what makes the label tappable.
 */
function FilterForm({ query, idPrefix }: { query: ProductQuery; idPrefix: string }) {
  const { filters, sort } = query;
  const active = hasActiveFilters(filters);

  return (
    <form method="get" action="/" className="space-y-6 text-sm">
      {/*
        `page` is deliberately absent. Changing a filter must return to page one:
        keeping page 3 while narrowing the results lands the visitor on an empty
        page and looks like the filter found nothing.
      */}

      <div>
        <label htmlFor={`${idPrefix}-q`} className="mb-2 block font-medium">
          Search
        </label>
        <input
          id={`${idPrefix}-q`}
          type="search"
          name={PARAM.search}
          defaultValue={filters.search ?? ""}
          placeholder="Nike, plaid, hoodie…"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />
      </div>

      {/* Size leads: thrift buyers filter by what fits before anything else. */}
      <CheckboxGroup
        legend="Size"
        name={PARAM.size}
        idPrefix={idPrefix}
        options={allSizes().map((size) => ({ value: size, label: size }))}
        selected={filters.sizes ?? []}
        inline
      />

      <CheckboxGroup
        legend="Category"
        name={PARAM.category}
        idPrefix={idPrefix}
        options={CATEGORIES.map((category) => ({
          value: category,
          label: CATEGORY_LABELS[category as Category],
        }))}
        selected={filters.categories ?? []}
      />

      <fieldset>
        <legend className="mb-2 font-medium">Price (KSh)</legend>
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-min`}
            type="number"
            inputMode="numeric"
            min={0}
            name={PARAM.min}
            defaultValue={centsToShillings(filters.minPriceCents)}
            placeholder="Min"
            aria-label="Minimum price in shillings"
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
          />
          <span className="text-neutral-400">to</span>
          <input
            id={`${idPrefix}-max`}
            type="number"
            inputMode="numeric"
            min={0}
            name={PARAM.max}
            defaultValue={centsToShillings(filters.maxPriceCents)}
            placeholder="Max"
            aria-label="Maximum price in shillings"
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
          />
        </div>
      </fieldset>

      <CheckboxGroup
        legend="Condition"
        name={PARAM.condition}
        idPrefix={idPrefix}
        options={CONDITIONS.map((condition) => ({
          value: condition,
          label: CONDITION_LABELS[condition as Condition],
        }))}
        selected={filters.conditions ?? []}
      />

      <CheckboxGroup
        legend="Fit"
        name={PARAM.gender}
        idPrefix={idPrefix}
        options={GENDERS.map((gender) => ({
          value: gender,
          label: GENDER_LABELS[gender as Gender],
        }))}
        selected={filters.genders ?? []}
      />

      <div>
        <label htmlFor={`${idPrefix}-sort`} className="mb-2 block font-medium">
          Sort
        </label>
        <select
          id={`${idPrefix}-sort`}
          name={PARAM.sort}
          defaultValue={sort}
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        >
          {SORTS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="flex-1 rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Apply
        </button>

        {active && (
          <Link
            href="/"
            className="rounded-lg px-3 py-2.5 text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
          >
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}

function CheckboxGroup({
  legend,
  name,
  idPrefix,
  options,
  selected,
  inline,
}: {
  legend: string;
  name: string;
  idPrefix: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  inline?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{legend}</legend>
      <div className={inline ? "flex flex-wrap gap-2" : "space-y-1.5"}>
        {options.map((option) => {
          const id = `${idPrefix}-${name}-${option.value}`;

          return (
            <div key={option.value} className={inline ? "" : "flex items-center gap-2"}>
              <input
                id={id}
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className={
                  inline ? "peer sr-only" : "size-4 accent-neutral-900 dark:accent-neutral-100"
                }
              />
              <label
                htmlFor={id}
                className={
                  inline
                    ? "block cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 select-none peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-900 dark:border-neutral-700 dark:peer-checked:border-neutral-100 dark:peer-checked:bg-neutral-100 dark:peer-checked:text-neutral-900"
                    : "cursor-pointer select-none"
                }
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The form talks in shillings; everything behind it talks in cents. */
function centsToShillings(cents: number | undefined): string {
  return cents === undefined ? "" : String(cents / 100);
}
