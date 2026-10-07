"use client";

import { Plus, X } from "lucide-react";
import { startTransition, useActionState, useId, useRef, useState } from "react";

import { type ProductFormState, saveProductAction } from "@/lib/admin/product-actions";
import { type FormErrors, type GridInput, cellKey } from "@/lib/admin/product-form";
import type { ProductFormValues } from "@/lib/admin/products";
import type { CategoryInfo } from "@/lib/shop/categories";

/**
 * Create or edit a product: its details, then the stock grid.
 *
 * The grid is the one part of the admin that needs JavaScript — a table of
 * inputs that grows a row per colour is not something a plain form can do.
 * Everything it sends is checked again on the server, so the browser is a
 * convenience, never the authority.
 */

type Option = { value: string; label: string };
type Cell = GridInput["cells"][number];
type Swatch = GridInput["swatches"][number];
type Mode = "stock" | "price";

const INPUT =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none";

export function ProductForm({
  initial,
  categories,
  conditions,
  genders,
}: {
  initial: ProductFormValues;
  categories: CategoryInfo[];
  conditions: Option[];
  genders: Option[];
}) {
  const [state, formAction, saving] = useActionState<ProductFormState, FormData>(
    saveProductAction,
    {},
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [price, setPrice] = useState(initial.price);
  const [swatches, setSwatches] = useState<Swatch[]>(initial.grid.swatches);
  const [cells, setCells] = useState<Map<string, Cell>>(
    () => new Map(initial.grid.cells.map((cell) => [cellKey(cell.swatchKey, cell.option2), cell])),
  );
  const [mode, setMode] = useState<Mode>("stock");
  const nextKey = useRef(0);
  // Fields edited since the last save attempt: their errors are out of date.
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const markEdited = (key: string) => {
    if (state.errors?.[key] && !edited.has(key)) setEdited(new Set(edited).add(key));
  };

  // A refused save reports stock that moved while the owner was editing. The
  // form takes it as what it was showing, so the next save is checked against
  // the new count instead of clashing again. Adjusted during render, React's
  // pattern for state that follows a prop.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setEdited(new Set());
    if (state.stockNow) {
      const now = state.stockNow;
      setCells((current) => {
        const next = new Map(current);
        for (const [key, cell] of next) {
          if (cell.id && now[cell.id] !== undefined) {
            next.set(key, { ...cell, stockWas: now[cell.id] });
          }
        }
        return next;
      });
    }
  }

  const errors: FormErrors = Object.fromEntries(
    Object.entries(state.errors ?? {}).filter(([key]) => !edited.has(key)),
  );

  const category = categories.find((candidate) => candidate.id === categoryId);
  const rows: (Swatch | null)[] = category?.option1Name && swatches.length > 0 ? swatches : [null];
  const columns = columnsFor(category, cells);

  function updateCell(swatchKey: string | null, option2: string | null, change: Partial<Cell>) {
    markEdited(cellKey(swatchKey, option2));
    setCells((current) => {
      const key = cellKey(swatchKey, option2);
      const cell = current.get(key) ?? {
        swatchKey,
        option2,
        id: null,
        stock: "",
        stockWas: null,
        price: "",
      };
      return new Map(current).set(key, { ...cell, ...change });
    });
  }

  function addSwatch() {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;

    setSwatches((current) => [...current, { key, id: null, name: "", hex: "#9ca3af" }]);
    // The first colour takes over the stock entered before there were colours.
    if (swatches.length === 0) {
      setCells(
        (current) =>
          new Map(
            [...current.values()]
              .filter((cell) => cell.swatchKey === null)
              .map((cell) => {
                const moved = { ...cell, swatchKey: key, id: null, stockWas: null };
                return [cellKey(key, cell.option2), moved];
              }),
          ),
      );
    }
  }

  function removeSwatch(key: string) {
    setSwatches((current) => current.filter((swatch) => swatch.key !== key));
    setCells((current) => new Map([...current].filter(([, cell]) => cell.swatchKey !== key)));
  }

  const grid: GridInput = {
    swatches: category?.option1Name ? swatches : [],
    cells: [...cells.values()].filter((cell) =>
      rows.some((row) => (row?.key ?? null) === cell.swatchKey),
    ),
  };
  const gridErrors = Object.entries(errors).filter(
    ([key]) => key === "grid" || key.startsWith("cell:") || key.startsWith("swatch:"),
  );

  return (
    <form
      // Submitted by hand rather than through `action`: React resets a form
      // after its action runs, and a refused save would then wipe what the
      // owner typed and put the category back to "Choose…".
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      onChange={(event) => {
        const { target } = event;
        const name = "name" in target && typeof target.name === "string" ? target.name : "";
        if (name) markEdited(name);
      }}
      className="flex flex-col gap-8"
      noValidate
    >
      <input type="hidden" name="productId" value={initial.id ?? ""} />
      <input type="hidden" name="grid" value={JSON.stringify(grid)} />

      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          Nothing was saved. Check the {plural(Object.keys(errors).length, "highlighted field")}{" "}
          below.
        </p>
      )}

      <section aria-labelledby="details" className="grid gap-4 sm:grid-cols-2">
        <h2 id="details" className="text-lg font-semibold sm:col-span-2">
          Details
        </h2>

        <Field label="Name" error={errors.title} className="sm:col-span-2">
          {(props) => (
            <input
              {...props}
              name="title"
              defaultValue={initial.title}
              maxLength={120}
              placeholder="Cargo Pants"
            />
          )}
        </Field>

        <Field label="Category" error={errors.categoryId}>
          {(props) => (
            <select
              {...props}
              name="categoryId"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Choose…</option>
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Price"
          hint="In shillings. Sizes or colours that cost more are set in the grid."
          error={errors.price}
        >
          {(props) => (
            <input
              {...props}
              name="price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="1,400"
            />
          )}
        </Field>

        <Field label="Brand" hint="Optional." error={errors.brand}>
          {(props) => (
            <input
              {...props}
              name="brand"
              defaultValue={initial.brand}
              maxLength={60}
              placeholder="Levi's"
            />
          )}
        </Field>

        {category?.showCondition && (
          <Field label="Condition" error={errors.condition}>
            {(props) => (
              <select {...props} name="condition" defaultValue={initial.condition}>
                <option value="">Choose…</option>
                {conditions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {category?.showFit && (
          <Field label="Fit" error={errors.gender}>
            {(props) => (
              <select {...props} name="gender" defaultValue={initial.gender}>
                <option value="">Choose…</option>
                {genders.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field
          label="Description"
          hint="Optional. Fabric, fit, measurements, flaws."
          error={errors.description}
          className="sm:col-span-2"
        >
          {(props) => (
            <textarea
              {...props}
              name="description"
              defaultValue={initial.description}
              rows={4}
              maxLength={2000}
            />
          )}
        </Field>
      </section>

      <section aria-labelledby="stock">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="stock" className="text-lg font-semibold">
              Stock
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              {category
                ? "Units on the shelf for each combination. Leave a cell empty if you don't make it; 0 means sold out."
                : "Choose a category first: it decides the sizes."}
            </p>
          </div>
          {category && (
            <div
              role="group"
              aria-label="Show"
              className="flex rounded-lg border border-border bg-surface-muted/50 p-0.5 text-sm"
            >
              {(["stock", "price"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={`rounded-md px-3 py-1.5 transition ${
                    mode === option
                      ? "bg-surface font-medium shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {option === "stock" ? "Stock" : "Prices"}
                </button>
              ))}
            </div>
          )}
        </div>

        {category && (
          <>
            {mode === "price" && (
              <p className="mt-3 text-sm text-muted">
                Empty cells cost the base price{price ? ` (KSh ${price})` : ""}. Set a whole{" "}
                {category.option2Name?.toLowerCase() ?? "column"} or{" "}
                {category.option1Name?.toLowerCase() ?? "row"} at once from its edge; a single cell
                beats both.
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] tracking-wider text-muted uppercase">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium"
                    >
                      {category.option1Name ?? ""}
                    </th>
                    {columns.map((column) => (
                      <th
                        key={column ?? "none"}
                        scope="col"
                        className="px-1 py-2 text-center font-medium normal-case"
                      >
                        {column ?? "Stock"}
                        {column !== null && !category.option2Values.includes(column) && (
                          <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                            not in {category.name}
                          </span>
                        )}
                      </th>
                    ))}
                    {mode === "price" && rows[0] !== null && (
                      <th scope="col" className="px-2 py-2 text-center font-medium">
                        All
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowKey = row?.key ?? null;
                    const rowError = row ? errors[`swatch:${row.key}`] : undefined;

                    return (
                      <tr key={rowKey ?? "none"} className="border-b border-border last:border-0">
                        {/* Pinned, so the colour stays in view while the sizes scroll on a phone. */}
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal"
                        >
                          {row ? (
                            <SwatchEditor
                              swatch={row}
                              label={category.option1Name ?? "Colour"}
                              error={rowError}
                              onChange={(change) => {
                                markEdited(`swatch:${row.key}`);
                                setSwatches((current) =>
                                  current.map((swatch) =>
                                    swatch.key === row.key ? { ...swatch, ...change } : swatch,
                                  ),
                                );
                              }}
                              onRemove={() => removeSwatch(row.key)}
                            />
                          ) : (
                            <span className="text-muted">
                              {category.option1Name
                                ? `One ${category.option1Name.toLowerCase()}`
                                : ""}
                            </span>
                          )}
                        </th>
                        {columns.map((column) => (
                          <td key={column ?? "none"} className="p-1 text-center">
                            <CellInput
                              mode={mode}
                              cell={cells.get(cellKey(rowKey, column))}
                              label={[row?.name, column].filter(Boolean).join(" ") || "Stock"}
                              basePrice={price}
                              held={heldFor(cells.get(cellKey(rowKey, column)), initial.held)}
                              error={errors[cellKey(rowKey, column)]}
                              onChange={(change) => updateCell(rowKey, column, change)}
                            />
                          </td>
                        ))}
                        {mode === "price" && row !== null && (
                          <td className="p-1">
                            <LinePrice
                              label={`Price for every ${row.name || "new colour"}`}
                              cells={columns.map((column) => cells.get(cellKey(rowKey, column)))}
                              onChange={(value) =>
                                columns.forEach((column) =>
                                  updateCell(rowKey, column, { price: value }),
                                )
                              }
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {mode === "price" && columns[0] !== null && (
                  <tfoot>
                    <tr className="border-t border-border">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[11px] font-medium tracking-wider text-muted uppercase"
                      >
                        Every {category.option1Name?.toLowerCase() ?? "row"}
                      </th>
                      {columns.map((column) => (
                        <td key={column ?? "none"} className="p-1">
                          <LinePrice
                            label={`Price for every ${column}`}
                            cells={rows.map((row) => cells.get(cellKey(row?.key ?? null, column)))}
                            onChange={(value) =>
                              rows.forEach((row) =>
                                updateCell(row?.key ?? null, column, { price: value }),
                              )
                            }
                          />
                        </td>
                      ))}
                      {rows[0] !== null && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {category.option1Name && (
              <button
                type="button"
                onClick={addSwatch}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-muted"
              >
                <Plus aria-hidden className="size-4" />
                Add {category.option1Name.toLowerCase()}
              </button>
            )}

            {gridErrors.length > 0 && (
              <ul role="alert" className="mt-3 space-y-1 text-sm text-red-700 dark:text-red-300">
                {gridErrors.map(([key, message]) => (
                  <li key={key}>
                    {describeErrorKey(key, swatches)}
                    {message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {saving ? "Saving…" : initial.id ? "Save changes" : "Create product"}
        </button>
      </div>
    </form>
  );
}

/** Option-2 values across the top: the category's, then any older ones in use. */
function columnsFor(
  category: CategoryInfo | undefined,
  cells: Map<string, Cell>,
): (string | null)[] {
  if (!category) return [];

  const inUse = [...cells.values()]
    .filter((cell) => cell.id !== null || cell.stock.trim() !== "")
    .map((cell) => cell.option2);
  if (!category.option2Name) return [null];

  const extra = inUse.filter(
    (value): value is string => value !== null && !category.option2Values.includes(value),
  );

  return [...category.option2Values, ...new Set(extra)];
}

function heldFor(cell: Cell | undefined, held: Record<string, number>): number {
  return cell?.id ? (held[cell.id] ?? 0) : 0;
}

function CellInput({
  mode,
  cell,
  label,
  basePrice,
  held,
  error,
  onChange,
}: {
  mode: Mode;
  cell: Cell | undefined;
  label: string;
  basePrice: string;
  held: number;
  error: string | undefined;
  onChange: (change: Partial<Cell>) => void;
}) {
  const border = error ? "border-red-500" : "border-border";
  const unmade = (cell?.stock ?? "").trim() === "";

  if (mode === "price") {
    return (
      <input
        aria-label={`${label} price`}
        value={cell?.price ?? ""}
        onChange={(event) => onChange({ price: event.target.value })}
        inputMode="decimal"
        placeholder={unmade ? "–" : basePrice || "Base"}
        title={error}
        className={`w-20 rounded-md border bg-transparent px-2 py-1.5 text-center tabular-nums focus:border-foreground focus:outline-none ${border} ${unmade ? "opacity-60" : ""}`}
      />
    );
  }

  // Marked until saved, so the owner can see what they are about to change.
  const changed =
    cell !== undefined && cell.stockWas !== null && !unmade && Number(cell.stock) !== cell.stockWas;

  return (
    <div className="flex flex-col items-center">
      <input
        aria-label={`${label} stock`}
        value={cell?.stock ?? ""}
        onChange={(event) => onChange({ stock: event.target.value.replace(/\D/g, "").slice(0, 4) })}
        inputMode="numeric"
        placeholder="–"
        title={error}
        className={`w-14 rounded-md border bg-transparent px-2 py-1.5 text-center tabular-nums focus:border-foreground focus:outline-none ${border} ${changed ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}
      />
      {held > 0 && <span className="mt-0.5 text-[10px] text-muted">{held} held</span>}
      {cell?.id && cell.stock.trim() === "" && (
        <span className="mt-0.5 text-[10px] text-red-700 dark:text-red-300">removed</span>
      )}
    </div>
  );
}

/**
 * One price for a whole row or column: fills every cell in it. Shows the
 * line's price when every cell already shares one.
 */
function LinePrice({
  label,
  cells,
  onChange,
}: {
  label: string;
  cells: (Cell | undefined)[];
  onChange: (value: string) => void;
}) {
  const prices = new Set(cells.map((cell) => cell?.price ?? ""));
  const shared = prices.size === 1 ? [...prices][0] : "";

  return (
    <input
      aria-label={label}
      value={shared}
      onChange={(event) => onChange(event.target.value)}
      inputMode="decimal"
      placeholder={prices.size > 1 ? "Mixed" : "—"}
      className="w-20 rounded-md border border-dashed border-border bg-transparent px-2 py-1.5 text-center tabular-nums focus:border-foreground focus:outline-none"
    />
  );
}

function SwatchEditor({
  swatch,
  label,
  error,
  onChange,
  onRemove,
}: {
  swatch: Swatch;
  label: string;
  error: string | undefined;
  onChange: (change: Partial<Swatch>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${swatch.name || label} dot colour`}
        value={swatch.hex || "#9ca3af"}
        onChange={(event) => onChange({ hex: event.target.value })}
        className="size-7 shrink-0 cursor-pointer rounded-full border border-border bg-transparent p-0"
      />
      <input
        aria-label={`${label} name`}
        value={swatch.name}
        onChange={(event) => onChange({ name: event.target.value })}
        maxLength={30}
        placeholder={label === "Colour" ? "Khaki" : label}
        title={error}
        className={`w-28 rounded-md border bg-transparent px-2 py-1.5 focus:border-foreground focus:outline-none ${error ? "border-red-500" : "border-border"}`}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${swatch.name || "this " + label.toLowerCase()}`}
        className="rounded-md p-1 text-muted transition hover:bg-surface-muted hover:text-foreground"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error: string | undefined;
  className?: string;
  children: (props: {
    id: string;
    className: string;
    "aria-invalid"?: boolean;
    "aria-describedby": string;
  }) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        className: `${INPUT} ${error ? "border-red-400" : "border-border"}`,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": `${id}-note`,
      })}
      <p
        id={`${id}-note`}
        className={`text-xs ${error ? "text-red-700 dark:text-red-300" : "text-muted"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

/** "Khaki 32: " before a cell's message, so the list below the grid reads on its own. */
function describeErrorKey(key: string, swatches: Swatch[]): string {
  if (key === "grid") return "";

  const nameOf = (swatchKey: string) =>
    swatches.find((swatch) => swatch.key === swatchKey)?.name || "New colour";

  if (key.startsWith("swatch:")) return `${nameOf(key.slice("swatch:".length))}: `;

  const [swatchKey, option2] = key.slice("cell:".length).split("|");
  const place = [swatchKey ? nameOf(swatchKey) : "", option2].filter(Boolean).join(" ");

  return place ? `${place}: ` : "";
}

function plural(count: number, noun: string): string {
  return count === 1 ? `${noun}` : `${count} ${noun}s`;
}
