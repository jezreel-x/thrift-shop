import { describe, expect, it } from "vitest";

import type { CategoryInfo } from "../shop/categories";
import { type GridInput, cellKey, parseProductForm } from "./product-form";

const PANTS: CategoryInfo = {
  id: "pants",
  slug: "pants",
  name: "Pants",
  position: 0,
  option1Name: "Colour",
  option2Name: "Waist",
  option2Values: ["30", "32", "34"],
  showCondition: false,
  showFit: true,
};

const PERFUME: CategoryInfo = {
  ...PANTS,
  id: "perfume",
  slug: "perfume",
  name: "Perfume",
  option1Name: null,
  option2Name: null,
  option2Values: [],
  showFit: false,
};

const FIELDS = { title: "Cargo Pants", price: "1,400", categoryId: "pants", gender: "UNISEX" };

const KHAKI = { key: "k", id: null, name: "Khaki", hex: "#C3B091" };

function cell(overrides: Partial<GridInput["cells"][number]> = {}): GridInput["cells"][number] {
  return {
    swatchKey: "k",
    option2: "32",
    id: null,
    stock: "3",
    stockWas: null,
    price: "",
    ...overrides,
  };
}

function parse(
  grid: Partial<GridInput>,
  fields: Record<string, string> = FIELDS,
  extra: { existingOption2?: string[] } = {},
) {
  return parseProductForm({
    fields,
    grid: JSON.stringify({ swatches: [KHAKI], cells: [cell()], ...grid }),
    categories: [PANTS, PERFUME],
    ...extra,
  });
}

describe("parseProductForm", () => {
  it("reads a product with one colour and one waist", () => {
    const result = parse({});

    expect(result).toEqual({
      ok: true,
      draft: {
        title: "Cargo Pants",
        description: null,
        brand: null,
        priceCents: 140_000,
        categoryId: "pants",
        condition: null,
        gender: "UNISEX",
        swatches: [{ key: "k", id: null, name: "Khaki", hex: "#c3b091", position: 0 }],
        cells: [
          { swatchKey: "k", option2: "32", id: null, stock: 3, stockWas: null, priceCents: null },
        ],
      },
    });
  });

  it("leaves out empty cells: not made is not the same as sold out", () => {
    const result = parse({ cells: [cell({ option2: "30", stock: "" }), cell({ stock: "0" })] });

    expect(result.ok && result.draft.cells.map((made) => [made.option2, made.stock])).toEqual([
      ["32", 0],
    ]);
  });

  it("asks for at least one cell", () => {
    const result = parse({ cells: [cell({ stock: "" })] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.grid).toMatch(/at least one size/);
  });

  it("requires a name, a price above zero and a category", () => {
    const result = parse({}, { title: " ", price: "0", categoryId: "nope" });

    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      "categoryId",
      "price",
      "title",
    ]);
  });

  it("asks for condition and fit only where the category shows them", () => {
    const pants = parse({}, { ...FIELDS, gender: "" });
    expect(!pants.ok && pants.errors).toEqual({ gender: "Choose who it's cut for." });

    const perfume = parse(
      { swatches: [], cells: [cell({ swatchKey: null, option2: null })] },
      { title: "Oud", price: "2500", categoryId: "perfume", gender: "MENS" },
    );
    expect(perfume.ok && [perfume.draft.condition, perfume.draft.gender]).toEqual([null, null]);
  });

  it("keeps a cell's own price, and drops one that equals the base", () => {
    const result = parse({
      cells: [cell({ option2: "30", price: "1,400" }), cell({ option2: "34", price: "1600" })],
    });

    expect(result.ok && result.draft.cells.map((made) => made.priceCents)).toEqual([null, 160_000]);
  });

  it("files a bad cell under that cell", () => {
    const result = parse({ cells: [cell({ stock: "2.5" }), cell({ option2: "34", price: "x" })] });

    expect(!result.ok && result.errors).toEqual({
      [cellKey("k", "32")]: "Stock is a whole number, 0 to 9999.",
      [cellKey("k", "34")]: "Enter a price, or leave it empty for the base price.",
    });
  });

  it("refuses a size the category does not offer, unless the product already has it", () => {
    const grid = { cells: [cell({ option2: "W40" })] };

    expect(parse(grid).ok).toBe(false);
    expect(parse(grid, FIELDS, { existingOption2: ["W40"] }).ok).toBe(true);
  });

  it("refuses two colours a buyer could not tell apart", () => {
    const result = parse({
      swatches: [KHAKI, { key: "k2", id: null, name: " khaki ", hex: "" }],
    });

    expect(!result.ok && result.errors).toEqual({ "swatch:k2": "There's already a khaki." });
  });

  it("puts every cell in a colour row once there are colours", () => {
    const result = parse({ cells: [cell({ swatchKey: null })] });

    expect(!result.ok && result.errors[cellKey(null, "32")]).toMatch(/isn't in the grid/);
  });

  it("refuses colours on a category without them", () => {
    const result = parse(
      { cells: [cell({ swatchKey: null, option2: null })] },
      { title: "Oud", price: "2500", categoryId: "perfume" },
    );

    expect(!result.ok && result.errors.grid).toMatch(/no colours/);
  });

  it("refuses a grid that is not what the form sends", () => {
    const result = parseProductForm({
      fields: FIELDS,
      grid: '{"swatches":[],"cells":[{"stock":3}]}',
      categories: [PANTS],
    });

    expect(!result.ok && result.errors.grid).toMatch(/could not be read/);
  });
});
