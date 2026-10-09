import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { reserveVariant } from "@/lib/shop/reservations";
import { categoryIdFor, stockOf } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { type DraftCell, type ProductDraft, cellKey } from "./product-form";
import {
  getProductForEdit,
  listAdminProducts,
  saveProduct,
  saveProductDetails,
  saveProductStock,
  setProductWithdrawn,
} from "./products";

cleanDatabaseBetweenTests();

async function staff() {
  return db.user.create({
    data: {
      email: "wanjiru@example.com",
      name: "Wanjiru",
      passwordHash: await hashPassword("a good passphrase"),
    },
  });
}

async function cargoPants(cells: Partial<DraftCell>[]): Promise<ProductDraft> {
  return {
    title: "Cargo Pants",
    description: null,
    brand: null,
    priceCents: 140_000,
    categoryId: await categoryIdFor("side-pocket-pants"),
    condition: null,
    gender: "UNISEX",
    swatches: [
      { key: "khaki", id: null, name: "Khaki", hex: "#c3b091", position: 0 },
      { key: "black", id: null, name: "Black", hex: "#111111", position: 1 },
    ],
    cells: cells.map((cell) => ({
      swatchKey: "khaki",
      option2: "M",
      id: null,
      stock: 1,
      stockWas: null,
      priceCents: null,
      ...cell,
    })),
  };
}

/** Creates the product, then returns its saved form as a draft to edit. */
async function created(cells: Partial<DraftCell>[], actorId: string) {
  const result = await saveProduct({ productId: null, draft: await cargoPants(cells), actorId });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));

  const form = (await getProductForEdit(result.id))!;
  const draft: ProductDraft = {
    ...(await cargoPants([])),
    swatches: form.grid.swatches.map((swatch, position) => ({
      key: swatch.key,
      id: swatch.id,
      name: swatch.name,
      hex: swatch.hex,
      position,
    })),
    cells: form.grid.cells.map((cell) => ({
      swatchKey: cell.swatchKey,
      option2: cell.option2,
      id: cell.id,
      stock: Number(cell.stock),
      stockWas: cell.stockWas,
      priceCents: cell.price === "" ? null : Number(cell.price) * 100,
    })),
  };

  return { id: result.id, slug: result.slug, draft, form };
}

describe("saveProduct", () => {
  it("creates a product with its colours, sizes, stock and opening ledger", async () => {
    const owner = await staff();
    const result = await saveProduct({
      productId: null,
      draft: await cargoPants([
        { option2: "M", stock: 3 },
        { option2: "L", stock: 0, priceCents: 160_000 },
        { swatchKey: "black", option2: "M", stock: 2 },
      ]),
      actorId: owner.id,
    });

    expect(result).toMatchObject({ ok: true, slug: "cargo-pants", kept: 0 });
    const product = await db.product.findFirstOrThrow({
      include: { variants: { include: { swatch: true } }, swatches: true },
    });
    expect(product.swatches.map((swatch) => swatch.name).sort()).toEqual(["Black", "Khaki"]);
    expect(
      product.variants
        .map((variant) => [
          variant.swatch?.name,
          variant.option2,
          variant.stock,
          variant.priceCents,
        ])
        .sort(),
    ).toEqual([
      ["Black", "M", 2, null],
      ["Khaki", "L", 0, 160_000],
      ["Khaki", "M", 3, null],
    ]);

    // Opening stock is in the ledger with who entered it; a 0 is not a movement.
    const ledger = await db.stockMovement.findMany({ orderBy: { change: "asc" } });
    expect(ledger.map((entry) => [entry.change, entry.reason, entry.actorId])).toEqual([
      [2, "opening stock", owner.id],
      [3, "opening stock", owner.id],
    ]);

    const audit = await db.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({ action: "product.create", actorId: owner.id });
  });

  it("gives a second product with the same name its own address", async () => {
    const owner = await staff();
    await created([{}], owner.id);
    const second = await created([{}], owner.id);

    expect(second.slug).toMatch(/^cargo-pants-[0-9a-f]{6}$/);
  });

  it("records a restock and a recount in the ledger", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }, { option2: "L", stock: 2 }], owner.id);

    draft.cells[0].stock = 5;
    draft.cells[1].stock = 1;
    expect(await saveProduct({ productId: id, draft, actorId: owner.id })).toMatchObject({
      ok: true,
    });

    const moves = await db.stockMovement.findMany({
      where: { reason: { not: "opening stock" } },
      orderBy: { change: "asc" },
    });
    expect(moves.map((move) => [move.change, move.reason])).toEqual([
      [-1, "count corrected"],
      [2, "restock"],
    ]);
  });

  it("does not undo a sale that happened while the form was open", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }, { option2: "L", stock: 2 }], owner.id);
    const sold = draft.cells[0].id!;

    // A sale lands after the owner opened the form...
    await db.productVariant.update({ where: { id: sold }, data: { stock: 2 } });

    // ...and the owner only changes the other size: the sale stays.
    draft.cells[1].stock = 4;
    expect((await saveProduct({ productId: id, draft, actorId: owner.id })).ok).toBe(true);
    expect(await stockOf(sold)).toBe(2);
  });

  it("refuses to overwrite stock that changed underneath the owner, and says what it is now", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }, { option2: "L", stock: 2 }], owner.id);
    const sold = draft.cells[0].id!;
    await db.productVariant.update({ where: { id: sold }, data: { stock: 2 } });

    // The owner recounts 3 as 4, not knowing one sold meanwhile.
    draft.cells[0].stock = 4;
    draft.cells[1].stock = 9;
    const result = await saveProduct({ productId: id, draft, actorId: owner.id });

    expect(result).toEqual({
      ok: false,
      errors: {
        [cellKey(draft.cells[0].swatchKey, "M")]:
          "Changed while you were editing: there are now 2. Check it and save again.",
      },
      stockNow: { [sold]: 2 },
    });
    // Nothing from the refused save was kept, not even the other cell.
    expect(await stockOf(sold)).toBe(2);
    expect(await stockOf(draft.cells[1].id!)).toBe(2);
  });

  it("does not let stock go below what buyers hold in checkout", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }], owner.id);
    await reserveVariant(draft.cells[0].id!, "buyer-1", 2);

    draft.cells[0].stock = 1;
    const result = await saveProduct({ productId: id, draft, actorId: owner.id });

    expect(!result.ok && Object.values(result.errors)).toEqual([
      "2 are in buyers' checkouts, so stock can't go below 2.",
    ]);
  });

  it("removes a cleared size, but not one in a buyer's checkout", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }, { option2: "L", stock: 2 }], owner.id);
    const [medium, large] = draft.cells;

    await reserveVariant(large.id!, "buyer-1", 1);
    const refused = await saveProduct({
      productId: id,
      draft: { ...draft, cells: [medium] },
      actorId: owner.id,
    });
    expect(!refused.ok && refused.errors.grid).toMatch(/^Khaki L is in a buyer's checkout/);

    await db.stockHold.deleteMany();
    const saved = await saveProduct({
      productId: id,
      draft: { ...draft, cells: [medium] },
      actorId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, kept: 0 });
    expect(await db.productVariant.count({ where: { id: large.id! } })).toBe(0);
  });

  it("keeps a cleared size that orders name, at stock 0", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }, { option2: "L", stock: 2 }], owner.id);
    const large = draft.cells[1];
    await db.order.create({
      data: {
        reference: "TP-TEST01",
        userId: owner.id,
        buyerName: "Achieng",
        buyerPhone: "254712345678",
        totalCents: 140_000,
        items: {
          create: {
            productId: id,
            variantId: large.id!,
            title: "Cargo Pants",
            size: "L",
            priceCents: 140_000,
          },
        },
      },
    });

    const result = await saveProduct({
      productId: id,
      draft: { ...draft, cells: [draft.cells[0]] },
      actorId: owner.id,
    });

    expect(result).toMatchObject({ ok: true, kept: 1 });
    expect(await stockOf(large.id!)).toBe(0);
    expect(
      await db.stockMovement.findFirst({ where: { variantId: large.id!, change: -2 } }),
    ).toMatchObject({ reason: "removed from the grid", actorId: owner.id });
  });

  it("removes a colour with its sizes, and can swap two colours' names", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 1 }, { swatchKey: "black", stock: 1 }], owner.id);

    const [khaki, black] = draft.swatches;
    const swapped = await saveProduct({
      productId: id,
      draft: {
        ...draft,
        swatches: [
          { ...khaki, name: "Black" },
          { ...black, name: "Khaki" },
        ],
      },
      actorId: owner.id,
    });
    expect(swapped.ok).toBe(true);

    const dropped = await saveProduct({
      productId: id,
      draft: {
        ...draft,
        swatches: [khaki],
        cells: draft.cells.filter((cell) => cell.swatchKey === khaki.key),
      },
      actorId: owner.id,
    });
    expect(dropped.ok).toBe(true);
    expect(await db.productSwatch.count()).toBe(1);
    expect(await db.productVariant.count()).toBe(1);
  });

  it("refuses to add a size someone else added while the form was open", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 1 }], owner.id);
    await db.productVariant.create({
      data: { productId: id, swatchId: draft.swatches[0].id, option2: "XL", stock: 4 },
    });

    const result = await saveProduct({
      productId: id,
      draft: { ...draft, cells: [...draft.cells, { ...draft.cells[0], id: null, option2: "XL" }] },
      actorId: owner.id,
    });

    expect(!result.ok && Object.values(result.errors)[0]).toMatch(/Someone else added/);
  });
});

describe("listAdminProducts and withdrawing", () => {
  it("lists products with total stock and a From price, withdrawn ones on their own", async () => {
    const owner = await staff();
    const { id } = await created(
      [{ stock: 3 }, { option2: "L", stock: 2, priceCents: 120_000 }],
      owner.id,
    );

    const active = await listAdminProducts({
      search: "cargo",
      categoryId: null,
      withdrawn: false,
      page: 1,
    });
    expect(active.products).toMatchObject([
      { id, stock: 5, fromPriceCents: 120_000, priceVaries: true, withdrawn: false },
    ]);

    expect(
      await setProductWithdrawn({ productId: id, withdrawn: true, actorId: owner.id }),
    ).toEqual({ ok: true, slug: "cargo-pants" });
    // Twice is not two audit entries.
    expect(
      (await setProductWithdrawn({ productId: id, withdrawn: true, actorId: owner.id })).ok,
    ).toBe(false);

    const lists = await Promise.all(
      [false, true].map((withdrawn) =>
        listAdminProducts({ search: "", categoryId: null, withdrawn, page: 1 }),
      ),
    );
    expect(lists.map((list) => list.total)).toEqual([0, 1]);
    expect(await db.auditLog.count({ where: { action: "product.withdraw" } })).toBe(1);
  });
});

/** The Details tab's part of a draft. */
function detailsOf(draft: ProductDraft) {
  const { title, description, brand, priceCents, categoryId, condition, gender } = draft;

  return { title, description, brand, priceCents, categoryId, condition, gender };
}

describe("saving one tab at a time", () => {
  it("saves the details without touching the grid", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }], owner.id);
    const details = detailsOf(draft);

    const result = await saveProductDetails({
      productId: id,
      details: { ...details, title: "Cargo Pants, relaxed fit", priceCents: 150_000 },
      actorId: owner.id,
    });

    expect(result.ok).toBe(true);
    const product = await db.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, swatches: true },
    });
    expect([product.title, product.priceCents]).toEqual(["Cargo Pants, relaxed fit", 150_000]);
    expect(product.variants.map((variant) => variant.stock)).toEqual([3]);
    expect(product.swatches.map((swatch) => swatch.name).sort()).toEqual(["Black", "Khaki"]);
  });

  it("saves the stock without touching the details", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 3 }], owner.id);
    draft.cells[0].stock = 7;

    const result = await saveProductStock({
      productId: id,
      grid: { swatches: draft.swatches, cells: draft.cells },
      actorId: owner.id,
    });

    expect(result.ok).toBe(true);
    expect(await stockOf(draft.cells[0].id!)).toBe(7);
    expect((await db.product.findUniqueOrThrow({ where: { id } })).title).toBe("Cargo Pants");
  });

  it("refuses a category the product's colours wouldn't fit", async () => {
    const owner = await staff();
    const { id, draft } = await created([{ stock: 1 }], owner.id);
    const noColours = await db.productCategory.create({
      data: {
        slug: "plain-test",
        name: "Plain",
        option2Name: "Size",
        option2Values: ["M"],
      },
    });
    const details = detailsOf(draft);

    try {
      const result = await saveProductDetails({
        productId: id,
        details: { ...details, categoryId: noColours.id },
        actorId: owner.id,
      });

      expect(!result.ok && result.errors.categoryId).toMatch(/Plain has no colours/);
      expect((await db.product.findUniqueOrThrow({ where: { id } })).categoryId).toBe(
        details.categoryId,
      );
    } finally {
      // Categories are reference data the per-test reset leaves alone.
      await db.productCategory.delete({ where: { id: noColours.id } });
    }
  });
});
