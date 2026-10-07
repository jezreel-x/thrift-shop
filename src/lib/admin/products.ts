import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { Condition, Gender } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { productSlug } from "../slug";
import { recordAudit } from "./audit";
import type { DraftCell, FormErrors, GridInput, ProductDraft } from "./product-form";
import { cellKey } from "./product-form";

/**
 * Products in the admin: the list, the edit form's data, and saving.
 *
 * A save is one transaction. It locks the product's variants first, so a sale
 * being confirmed at the same moment either finishes before the save reads
 * stock or waits until the save is done; never half of each. Then three rules
 * protect what buyers are doing while the owner edits:
 *
 *   1. Stock the owner did not touch is not written. A sale since the form
 *      opened stays sold.
 *   2. Stock the owner did change, but which also changed underneath them, is
 *      refused with the new count. Saving their number would bring a sold unit
 *      back, or hide a restock somebody else just did.
 *   3. Nothing goes below what buyers hold in checkout, and a size a buyer is
 *      paying for cannot be removed.
 *
 * Every stock change is a StockMovement with who made it; every save is in the
 * audit log.
 */

export const PRODUCTS_PAGE_SIZE = 24;

/* ---------------------------------------------------------------- the list */

export type AdminProductRow = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  category: string | null;
  thumbnail: { url: string; alt: string } | null;
  options: { swatches: number; variants: number };
  /** Units on the shelf, across every variant. */
  stock: number;
  fromPriceCents: number;
  priceVaries: boolean;
  withdrawn: boolean;
  updatedAt: Date;
};

export async function listAdminProducts(input: {
  search: string;
  categoryId: string | null;
  withdrawn: boolean;
  page: number;
}): Promise<{ products: AdminProductRow[]; total: number; pageCount: number }> {
  const where: Prisma.ProductWhereInput = {
    deletedAt: input.withdrawn ? { not: null } : null,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.search
      ? {
          OR: [
            { title: { contains: input.search, mode: "insensitive" } },
            { brand: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (input.page - 1) * PRODUCTS_PAGE_SIZE,
      take: PRODUCTS_PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        title: true,
        brand: true,
        priceCents: true,
        deletedAt: true,
        updatedAt: true,
        categoryRef: { select: { name: true } },
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
        variants: { select: { stock: true, priceCents: true } },
        _count: { select: { swatches: true } },
      },
    }),
  ]);

  const products = rows.map((row): AdminProductRow => {
    const prices = row.variants.map((variant) => variant.priceCents ?? row.priceCents);
    const image = row.images[0];

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      category: row.categoryRef?.name ?? null,
      thumbnail: image ? { url: image.url, alt: image.alt ?? row.title } : null,
      options: { swatches: row._count.swatches, variants: row.variants.length },
      stock: row.variants.reduce((sum, variant) => sum + variant.stock, 0),
      fromPriceCents: prices.length > 0 ? Math.min(...prices) : row.priceCents,
      priceVaries: new Set(prices).size > 1,
      withdrawn: row.deletedAt !== null,
      updatedAt: row.updatedAt,
    };
  });

  return { products, total, pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE)) };
}

/* ------------------------------------------------------------ the edit form */

export type ProductFormValues = {
  id: string | null;
  slug: string | null;
  title: string;
  description: string;
  brand: string;
  price: string;
  categoryId: string;
  condition: Condition | "";
  gender: Gender | "";
  withdrawn: boolean;
  grid: GridInput;
  /** Units in buyers' checkouts, by variant: the floor for its stock. */
  held: Record<string, number>;
  /** Variants on past orders: removing them keeps them, at stock 0. */
  onOrders: string[];
  /** The first photo, until photos can be managed here. */
  thumbnail: { url: string; alt: string } | null;
  /** Changes whenever the product is saved; remounts the form with fresh data. */
  version: string;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  id: null,
  slug: null,
  title: "",
  description: "",
  brand: "",
  price: "",
  categoryId: "",
  condition: "",
  gender: "",
  withdrawn: false,
  grid: { swatches: [], cells: [] },
  held: {},
  onOrders: [],
  thumbnail: null,
  version: "new",
};

export async function getProductForEdit(
  id: string,
  now: Date = new Date(),
): Promise<ProductFormValues | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      swatches: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      variants: {
        orderBy: { createdAt: "asc" },
        include: {
          holds: { where: { expiresAt: { gt: now } }, select: { quantity: true } },
          _count: { select: { orderItems: true } },
        },
      },
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
    },
  });
  if (!product) return null;

  const held: Record<string, number> = {};
  for (const variant of product.variants) {
    const units = variant.holds.reduce((sum, hold) => sum + hold.quantity, 0);
    if (units > 0) held[variant.id] = units;
  }
  const image = product.images[0];

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description ?? "",
    brand: product.brand ?? "",
    price: centsToInput(product.priceCents),
    categoryId: product.categoryId ?? "",
    condition: product.condition ?? "",
    gender: product.gender ?? "",
    withdrawn: product.deletedAt !== null,
    grid: {
      // Existing swatches are keyed by their id; new ones get a key in the browser.
      swatches: product.swatches.map((swatch) => ({
        key: swatch.id,
        id: swatch.id,
        name: swatch.name,
        hex: swatch.hex ?? "",
      })),
      cells: product.variants.map((variant) => ({
        swatchKey: variant.swatchId,
        option2: variant.option2,
        id: variant.id,
        stock: String(variant.stock),
        stockWas: variant.stock,
        price: variant.priceCents === null ? "" : centsToInput(variant.priceCents),
      })),
    },
    held,
    onOrders: product.variants
      .filter((variant) => variant._count.orderItems > 0)
      .map((variant) => variant.id),
    thumbnail: image ? { url: image.url, alt: image.alt ?? product.title } : null,
    version: product.updatedAt.toISOString(),
  };
}

/** 140000 → "1400"; 140050 → "1400.50". What the owner would type. */
export function centsToInput(cents: number): string {
  const shillings = Math.floor(cents / 100);
  const fraction = cents % 100;

  return fraction === 0 ? String(shillings) : `${shillings}.${String(fraction).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ saving */

export type SaveResult =
  | {
      ok: true;
      id: string;
      slug: string;
      /** Variants the owner removed that stay, at stock 0, because orders name them. */
      kept: number;
    }
  | {
      ok: false;
      errors: FormErrors;
      /** Current stock of cells that changed while the owner was editing. */
      stockNow?: Record<string, number>;
    };

/** Thrown inside the transaction to roll it back with what to tell the owner. */
class SaveRefused extends Error {
  constructor(
    readonly errors: FormErrors,
    readonly stockNow?: Record<string, number>,
  ) {
    super("save refused");
  }
}

type ExistingVariant = {
  id: string;
  swatchId: string | null;
  option2: string | null;
  stock: number;
  priceCents: number | null;
  held: number;
  onOrders: boolean;
  label: string;
};

/**
 * Creates a product (`productId` null) or saves one, with its whole grid.
 */
export async function saveProduct(input: {
  productId: string | null;
  draft: ProductDraft;
  actorId: string;
  now?: Date;
}): Promise<SaveResult> {
  const { draft, actorId } = input;
  const now = input.now ?? new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const product = input.productId
        ? await lockProduct(tx, input.productId)
        : await createProduct(tx, draft);
      const creating = input.productId === null;

      const existing = creating ? [] : await lockVariants(tx, product.id, now);
      const swatchesBefore = creating
        ? []
        : await tx.productSwatch.findMany({ where: { productId: product.id } });
      const before = creating ? null : await snapshot(tx, product.id);

      if (!creating) {
        await tx.product.update({
          where: { id: product.id },
          data: {
            title: draft.title,
            description: draft.description,
            brand: draft.brand,
            priceCents: draft.priceCents,
            categoryId: draft.categoryId,
            condition: draft.condition,
            gender: draft.gender,
            // The slug stays: links to it are already in WhatsApp chats.
          },
        });
      }

      // ---- First, check the grid still describes this product. Nothing in it is written yet.
      const knownSwatches = new Map(swatchesBefore.map((swatch) => [swatch.id, swatch]));
      if (draft.swatches.some((swatch) => swatch.id && !knownSwatches.has(swatch.id))) {
        throw new SaveRefused({ grid: "A colour on this form no longer exists. Reload." });
      }
      // Existing swatches are known by id now; new ones get theirs when created.
      const existingSwatchId = new Map(
        draft.swatches.flatMap((swatch) => (swatch.id ? [[swatch.key, swatch.id] as const] : [])),
      );
      const swatchIdOf = (key: string | null) =>
        key === null ? null : (existingSwatchId.get(key) ?? undefined);

      const byId = new Map(existing.map((variant) => [variant.id, variant]));
      const byPlace = new Set(
        existing.map((variant) => placeKey(variant.swatchId, variant.option2)),
      );
      const errors: FormErrors = {};
      const kept = new Set<string>();

      for (const cell of draft.cells) {
        const swatchId = swatchIdOf(cell.swatchKey);
        const field = cellKey(cell.swatchKey, cell.option2);

        if (cell.id === null) {
          // A new colour's cells cannot already exist.
          if (swatchId !== undefined && byPlace.has(placeKey(swatchId, cell.option2))) {
            errors[field] = "Someone else added this size while you were editing. Reload.";
          }
          continue;
        }

        const variant = byId.get(cell.id);
        if (!variant || variant.swatchId !== swatchId || variant.option2 !== cell.option2) {
          errors[field] = "This size changed while you were editing. Reload.";
          continue;
        }
        kept.add(variant.id);
      }

      const removed = existing.filter((variant) => !kept.has(variant.id));
      const inCheckout = removed.filter((variant) => variant.held > 0);
      if (inCheckout.length > 0) {
        errors.grid =
          `${list(inCheckout.map((variant) => variant.label))} ${inCheckout.length === 1 ? "is" : "are"} ` +
          "in a buyer's checkout, so it can't be removed yet. Put the stock back, or wait until they finish.";
      }
      if (Object.keys(errors).length > 0) throw new SaveRefused(errors);

      // ---- What the owner cleared goes first, freeing its names for reuse:
      // removed, or kept at 0 where orders name it.
      let keptOnOrders = 0;
      for (const variant of removed) {
        if (variant.onOrders) {
          keptOnOrders += 1;
          if (variant.stock > 0) {
            await tx.productVariant.update({ where: { id: variant.id }, data: { stock: 0 } });
            await tx.stockMovement.create({
              data: {
                variantId: variant.id,
                change: -variant.stock,
                reason: "removed from the grid",
                actorId,
              },
            });
          }
        } else {
          await tx.productVariant.delete({ where: { id: variant.id } });
        }
      }

      const stillUsed = new Set(
        (
          await tx.productVariant.findMany({
            where: { productId: product.id },
            select: { swatchId: true },
          })
        ).map((variant) => variant.swatchId),
      );
      const wanted = new Set(existingSwatchId.values());
      const leaving = swatchesBefore.filter((swatch) => !wanted.has(swatch.id));
      const staying = leaving.filter((swatch) => stillUsed.has(swatch.id));
      await tx.productSwatch.deleteMany({
        where: {
          id: { in: leaving.filter((swatch) => !stillUsed.has(swatch.id)).map((s) => s.id) },
        },
      });

      // A colour kept for past orders keeps its name, so nothing else can take it.
      const draftNames = new Set(draft.swatches.map((swatch) => swatch.name.toLowerCase()));
      const clash = staying.find((swatch) => draftNames.has(swatch.name.toLowerCase()));
      if (clash) {
        throw new SaveRefused({
          grid: `${clash.name} is on past orders, so it stays on this product. Give the new one a different name.`,
        });
      }

      // ---- Swatches: renamed ones are parked under temporary names first, so
      // swapping two names does not trip the unique (product, name) index.
      const renamed = draft.swatches.filter(
        (swatch) => swatch.id && knownSwatches.get(swatch.id)?.name !== swatch.name,
      );
      for (const swatch of renamed) {
        await tx.productSwatch.update({
          where: { id: swatch.id! },
          data: { name: `~renaming ${swatch.id}` },
        });
      }
      const swatchIds = new Map<string, string>();
      for (const swatch of draft.swatches) {
        const data = { name: swatch.name, hex: swatch.hex, position: swatch.position };
        const saved = swatch.id
          ? await tx.productSwatch.update({ where: { id: swatch.id }, data })
          : await tx.productSwatch.create({ data: { ...data, productId: product.id } });
        swatchIds.set(swatch.key, saved.id);
      }

      // ---- Cells.
      const stockNow: Record<string, number> = {};
      for (const cell of draft.cells) {
        if (cell.id === null) {
          const swatchId = cell.swatchKey === null ? null : swatchIds.get(cell.swatchKey)!;
          await createVariant(tx, { productId: product.id, swatchId, cell, actorId });
          continue;
        }

        const variant = byId.get(cell.id)!;
        const problem = await updateVariant(tx, { variant, cell, actorId });
        if (problem) {
          errors[cellKey(cell.swatchKey, cell.option2)] = problem.message;
          // The form needs the new count, or saving again would clash again.
          if (problem.changed) stockNow[variant.id] = variant.stock;
        }
      }
      if (Object.keys(errors).length > 0) {
        throw new SaveRefused(errors, Object.keys(stockNow).length > 0 ? stockNow : undefined);
      }

      await recordAudit(tx, {
        actorId,
        action: creating ? "product.create" : "product.update",
        entityType: "Product",
        entityId: product.id,
        before: before ?? undefined,
        after: await snapshot(tx, product.id),
      });

      return { ok: true, id: product.id, slug: product.slug, kept: keptOnOrders };
    });
  } catch (error) {
    if (error instanceof SaveRefused) {
      return { ok: false, errors: error.errors, stockNow: error.stockNow };
    }
    throw error;
  }
}

async function updateVariant(
  tx: Prisma.TransactionClient,
  { variant, cell, actorId }: { variant: ExistingVariant; cell: DraftCell; actorId: string },
): Promise<{ message: string; changed: boolean } | null> {
  const touched = cell.stock !== cell.stockWas;

  if (touched) {
    if (variant.stock !== cell.stockWas) {
      return {
        message: `Changed while you were editing: there ${variant.stock === 1 ? "is" : "are"} now ${variant.stock}. Check it and save again.`,
        changed: true,
      };
    }
    if (cell.stock < variant.held) {
      return {
        message: `${variant.held} ${variant.held === 1 ? "is" : "are"} in buyers' checkouts, so stock can't go below ${variant.held}.`,
        changed: false,
      };
    }
  }

  const stockChange = touched ? cell.stock - variant.stock : 0;
  if (stockChange === 0 && cell.priceCents === variant.priceCents) return null;

  await tx.productVariant.update({
    where: { id: variant.id },
    data: { priceCents: cell.priceCents, ...(stockChange !== 0 ? { stock: cell.stock } : {}) },
  });
  if (stockChange !== 0) {
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        change: stockChange,
        reason: stockChange > 0 ? "restock" : "count corrected",
        actorId,
      },
    });
  }

  return null;
}

async function createVariant(
  tx: Prisma.TransactionClient,
  input: { productId: string; swatchId: string | null; cell: DraftCell; actorId: string },
): Promise<void> {
  const variant = await tx.productVariant.create({
    data: {
      productId: input.productId,
      swatchId: input.swatchId,
      option2: input.cell.option2,
      stock: input.cell.stock,
      priceCents: input.cell.priceCents,
    },
  });

  if (input.cell.stock > 0) {
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        change: input.cell.stock,
        reason: "opening stock",
        actorId: input.actorId,
      },
    });
  }
}

/** Locks the product row, so two saves of one product run one after the other. */
async function lockProduct(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await tx.$queryRaw<{ id: string; slug: string }[]>`
    SELECT "id", "slug" FROM "Product" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!row) throw new SaveRefused({ grid: "This product no longer exists." });

  return row;
}

/**
 * The product's variants, locked: a sale confirming now waits for this save,
 * or this save waits for it. With what buyers hold and whether orders name each.
 */
async function lockVariants(
  tx: Prisma.TransactionClient,
  productId: string,
  now: Date,
): Promise<ExistingVariant[]> {
  const locked = await tx.$queryRaw<{ id: string; stock: number }[]>`
    SELECT "id", "stock" FROM "ProductVariant" WHERE "productId" = ${productId} FOR UPDATE
  `;
  const stock = new Map(locked.map((row) => [row.id, row.stock]));

  const variants = await tx.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      swatchId: true,
      option2: true,
      priceCents: true,
      swatch: { select: { name: true } },
      holds: { where: { expiresAt: { gt: now } }, select: { quantity: true } },
      _count: { select: { orderItems: true } },
    },
  });

  return variants.map((variant) => ({
    id: variant.id,
    swatchId: variant.swatchId,
    option2: variant.option2,
    // From the locked read, which is what a sale waiting on the lock will see.
    stock: stock.get(variant.id) ?? 0,
    priceCents: variant.priceCents,
    held: variant.holds.reduce((sum, hold) => sum + hold.quantity, 0),
    onOrders: variant._count.orderItems > 0,
    label: [variant.swatch?.name, variant.option2].filter(Boolean).join(" ") || "This item",
  }));
}

async function createProduct(
  tx: Prisma.TransactionClient,
  draft: ProductDraft,
): Promise<{ id: string; slug: string }> {
  // "black leather jacket" will recur; a short random tail keeps each its own page.
  const bare = productSlug(draft.title);
  const taken = await tx.product.findUnique({ where: { slug: bare }, select: { id: true } });
  const slug = taken ? productSlug(draft.title, randomBytes(3).toString("hex")) : bare;

  return tx.product.create({
    data: {
      slug,
      title: draft.title,
      description: draft.description,
      brand: draft.brand,
      priceCents: draft.priceCents,
      categoryId: draft.categoryId,
      condition: draft.condition,
      gender: draft.gender,
    },
    select: { id: true, slug: true },
  });
}

/** What the audit log keeps of a product: its details and its stock by cell. */
async function snapshot(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<Prisma.InputJsonObject> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      title: true,
      description: true,
      brand: true,
      priceCents: true,
      categoryId: true,
      condition: true,
      gender: true,
      variants: {
        orderBy: { createdAt: "asc" },
        select: {
          option2: true,
          stock: true,
          priceCents: true,
          swatch: { select: { name: true } },
        },
      },
    },
  });

  return {
    title: product.title,
    description: product.description,
    brand: product.brand,
    priceCents: product.priceCents,
    categoryId: product.categoryId,
    condition: product.condition,
    gender: product.gender,
    variants: product.variants.map((variant) => ({
      option1: variant.swatch?.name ?? null,
      option2: variant.option2,
      stock: variant.stock,
      priceCents: variant.priceCents,
    })),
  };
}

function placeKey(swatchId: string | null, option2: string | null): string {
  return `${swatchId ?? ""}|${option2 ?? ""}`;
}

function list(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* --------------------------------------------------------- withdraw/restore */

/**
 * Takes a product off the shop, or puts it back. Soft: orders that name it
 * keep it, and restoring brings back exactly what was there.
 *
 * Buyers already paying for it can still be confirmed; nobody new can reserve it.
 */
export async function setProductWithdrawn(input: {
  productId: string;
  withdrawn: boolean;
  actorId: string;
}): Promise<{ ok: boolean; slug?: string }> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.product.updateMany({
      where: { id: input.productId, deletedAt: input.withdrawn ? null : { not: null } },
      data: { deletedAt: input.withdrawn ? new Date() : null },
    });
    // Already in that state: nothing to record.
    if (count === 0) return { ok: false };

    await recordAudit(tx, {
      actorId: input.actorId,
      action: input.withdrawn ? "product.withdraw" : "product.restore",
      entityType: "Product",
      entityId: input.productId,
    });

    const { slug } = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: { slug: true },
    });

    return { ok: true, slug };
  });
}

/** Option-2 values a product's variants have now. Kept valid when editing. */
export async function existingOption2(productId: string): Promise<string[]> {
  const variants = await prisma.productVariant.findMany({
    where: { productId, option2: { not: null } },
    select: { option2: true },
    distinct: ["option2"],
  });

  return variants.flatMap((variant) => (variant.option2 ? [variant.option2] : []));
}
