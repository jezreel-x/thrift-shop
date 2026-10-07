import { Condition, Gender } from "@/generated/prisma/enums";
import { InvalidPriceError, parsePriceToCents } from "../money";
import type { CategoryInfo } from "../shop/categories";
import { swatchSlug } from "../shop/variant-choice";

/**
 * Reading the product form: the details, and the stock grid.
 *
 * The grid is option-1 values (swatches) down and the category's option-2
 * values across, one cell per combination:
 *
 *              30     32     34
 *   Khaki       3      2      –        – = not made: no variant
 *   Black       4      0      1        0 = made, sold out
 *
 * Pure — no database — so every rule is unit-tested. What only the database
 * can answer (did stock change while the owner was editing? is a size in
 * somebody's checkout?) is checked when saving, in products.ts.
 *
 * Prices come in at three levels — the base, a whole row or column, a single
 * cell — but the row and column inputs only fill cells in the browser. What
 * arrives here is a price per cell, which is all the shop ever asks: what does
 * this variant cost? See docs/product-variants.md.
 */

export const LIMITS = {
  title: 120,
  description: 2000,
  brand: 60,
  swatchName: 30,
  swatches: 20,
  stock: 9999,
} as const;

/** The grid as the browser sends it. Strings, because that is what inputs hold. */
export type GridInput = {
  swatches: { key: string; id: string | null; name: string; hex: string }[];
  cells: {
    swatchKey: string | null;
    option2: string | null;
    /** The variant, when the cell already exists. */
    id: string | null;
    /** Empty: not made. */
    stock: string;
    /** The stock the form was showing, so a sale since then is not overwritten. */
    stockWas: number | null;
    /** Empty: the base price. */
    price: string;
  }[];
};

export type DraftSwatch = {
  key: string;
  id: string | null;
  name: string;
  hex: string | null;
  position: number;
};

export type DraftCell = {
  swatchKey: string | null;
  option2: string | null;
  id: string | null;
  stock: number;
  stockWas: number | null;
  /** Null: the base price. */
  priceCents: number | null;
};

export type ProductDraft = {
  title: string;
  description: string | null;
  brand: string | null;
  priceCents: number;
  categoryId: string;
  condition: Condition | null;
  gender: Gender | null;
  swatches: DraftSwatch[];
  cells: DraftCell[];
};

/**
 * Errors by field. Swatches are keyed `swatch:<key>` and cells
 * `cell:<swatchKey>|<option2>` so the grid can mark the one that is wrong.
 */
export type FormErrors = Record<string, string>;

export type DraftResult = { ok: true; draft: ProductDraft } | { ok: false; errors: FormErrors };

/** Where a cell's error is filed. */
export function cellKey(swatchKey: string | null, option2: string | null): string {
  return `cell:${swatchKey ?? ""}|${option2 ?? ""}`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const STOCK = /^\d{1,4}$/;

export function parseProductForm(input: {
  fields: Record<string, string>;
  /** The grid's hidden field, as JSON. */
  grid: string;
  categories: CategoryInfo[];
  /**
   * Option-2 values this product's variants already have. Kept valid even if
   * the category's list has since changed, so an old "W32" can still be edited.
   */
  existingOption2?: string[];
}): DraftResult {
  const { fields } = input;
  const errors: FormErrors = {};

  const title = clean(fields.title);
  if (!title) errors.title = "Give the product a name.";
  else if (title.length > LIMITS.title) errors.title = `At most ${LIMITS.title} characters.`;

  // Line breaks are kept: a description is often a short list.
  const description = (fields.description ?? "").trim().replace(/\r\n/g, "\n");
  if (description.length > LIMITS.description) {
    errors.description = `At most ${LIMITS.description} characters.`;
  }

  const brand = clean(fields.brand);
  if (brand.length > LIMITS.brand) errors.brand = `At most ${LIMITS.brand} characters.`;

  const priceCents = readPrice(fields.price);
  if (priceCents === null) errors.price = "Enter the price, such as 1,400.";
  else if (priceCents === 0) errors.price = "The price can't be zero.";

  const category = input.categories.find((candidate) => candidate.id === fields.categoryId);
  if (!category) errors.categoryId = "Choose a category.";

  let condition: Condition | null = null;
  let gender: Gender | null = null;
  if (category?.showCondition) {
    condition = oneOf(fields.condition, Object.values(Condition));
    if (!condition) errors.condition = "Choose the condition.";
  }
  if (category?.showFit) {
    gender = oneOf(fields.gender, Object.values(Gender));
    if (!gender) errors.gender = "Choose who it's cut for.";
  }

  const grid = readGrid(input.grid);
  if (!grid) {
    // Only a tampered or broken page sends this; the form always sends JSON.
    return { ok: false, errors: { ...errors, grid: "The stock grid could not be read. Reload." } };
  }

  const swatches = category
    ? readSwatches(grid, category, errors)
    : { list: [], keys: new Set<string>() };
  const cells = category
    ? readCells(grid, {
        category,
        swatchKeys: swatches.keys,
        hasSwatches: swatches.list.length > 0,
        existingOption2: new Set(input.existingOption2 ?? []),
        baseCents: priceCents,
        errors,
      })
    : [];

  if (category && cells.length === 0 && !hasGridErrors(errors)) {
    errors.grid = "Enter stock for at least one size: 0 if it's sold out, 1 for a single item.";
  }

  if (Object.keys(errors).length > 0 || !category || priceCents === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    draft: {
      title,
      description: description || null,
      brand: brand || null,
      priceCents,
      categoryId: category.id,
      condition,
      gender,
      swatches: swatches.list,
      cells,
    },
  };
}

function readSwatches(
  grid: GridInput,
  category: CategoryInfo,
  errors: FormErrors,
): { list: DraftSwatch[]; keys: Set<string> } {
  const list: DraftSwatch[] = [];
  const keys = new Set<string>();
  const slugs = new Set<string>();

  if (!category.option1Name && grid.swatches.length > 0) {
    errors.grid = `${category.name} has no colours to choose between. Remove them, or choose another category.`;
    return { list, keys };
  }
  if (grid.swatches.length > LIMITS.swatches) {
    errors.grid = `At most ${LIMITS.swatches} ${category.option1Name?.toLowerCase()}s.`;
    return { list, keys };
  }

  grid.swatches.forEach((swatch, position) => {
    const name = clean(swatch.name);
    const hex = swatch.hex.trim();
    const field = `swatch:${swatch.key}`;
    keys.add(swatch.key);

    if (!name) errors[field] = "Give it a name.";
    else if (name.length > LIMITS.swatchName) {
      errors[field] = `At most ${LIMITS.swatchName} characters.`;
    } else if (slugs.has(swatchSlug(name))) {
      // The URL names the swatch (?option1=khaki), so two that read the same
      // would be one choice to a buyer.
      errors[field] = `There's already a ${name}.`;
    } else if (hex && !HEX.test(hex)) errors[field] = "Pick the colour again.";

    slugs.add(swatchSlug(name));
    list.push({
      key: swatch.key,
      id: swatch.id,
      name,
      hex: hex ? hex.toLowerCase() : null,
      position,
    });
  });

  return { list, keys };
}

function readCells(
  grid: GridInput,
  context: {
    category: CategoryInfo;
    swatchKeys: Set<string>;
    hasSwatches: boolean;
    existingOption2: Set<string>;
    baseCents: number | null;
    errors: FormErrors;
  },
): DraftCell[] {
  const { category, errors } = context;
  const cells: DraftCell[] = [];
  const seen = new Set<string>();

  for (const cell of grid.cells) {
    const stockText = cell.stock.trim();
    // An empty cell is not made: no variant.
    if (stockText === "") continue;

    const field = cellKey(cell.swatchKey, cell.option2);

    if (seen.has(field)) {
      errors[field] = "This size appears twice.";
      continue;
    }
    seen.add(field);

    const rowOk = context.hasSwatches
      ? cell.swatchKey !== null && context.swatchKeys.has(cell.swatchKey)
      : cell.swatchKey === null;
    const columnOk = category.option2Name
      ? cell.option2 !== null &&
        (category.option2Values.includes(cell.option2) || context.existingOption2.has(cell.option2))
      : cell.option2 === null;
    if (!rowOk || !columnOk) {
      errors[field] = "This cell isn't in the grid any more. Clear it.";
      continue;
    }

    if (!STOCK.test(stockText)) {
      errors[field] = `Stock is a whole number, 0 to ${LIMITS.stock}.`;
      continue;
    }

    let priceCents: number | null = null;
    if (cell.price.trim() !== "") {
      priceCents = readPrice(cell.price);
      if (priceCents === null || priceCents === 0) {
        errors[field] = "Enter a price, or leave it empty for the base price.";
        continue;
      }
      // The same as the base is the base: a later change to the base should
      // move this cell with it.
      if (priceCents === context.baseCents) priceCents = null;
    }

    cells.push({
      swatchKey: cell.swatchKey,
      option2: cell.option2,
      id: cell.id,
      stock: Number(stockText),
      stockWas: cell.stockWas,
      priceCents,
    });
  }

  return cells;
}

function hasGridErrors(errors: FormErrors): boolean {
  return Object.keys(errors).some(
    (key) => key === "grid" || key.startsWith("cell:") || key.startsWith("swatch:"),
  );
}

/**
 * The grid's JSON, checked for shape. Null if it is not what the form sends.
 */
function readGrid(raw: string): GridInput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || !Array.isArray(value.swatches) || !Array.isArray(value.cells)) {
    return null;
  }

  const swatchesOk = value.swatches.every(
    (swatch) =>
      isRecord(swatch) &&
      typeof swatch.key === "string" &&
      nullableString(swatch.id) &&
      typeof swatch.name === "string" &&
      typeof swatch.hex === "string",
  );
  const cellsOk = value.cells.every(
    (cell) =>
      isRecord(cell) &&
      nullableString(cell.swatchKey) &&
      nullableString(cell.option2) &&
      nullableString(cell.id) &&
      typeof cell.stock === "string" &&
      (cell.stockWas === null || Number.isSafeInteger(cell.stockWas)) &&
      typeof cell.price === "string",
  );

  return swatchesOk && cellsOk ? (value as GridInput) : null;
}

function readPrice(raw: string | undefined): number | null {
  try {
    return parsePriceToCents(raw ?? "");
  } catch (error) {
    if (error instanceof InvalidPriceError) return null;
    throw error;
  }
}

function clean(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

function oneOf<T extends string>(raw: string | undefined, values: T[]): T | null {
  return values.includes(raw as T) ? (raw as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}
