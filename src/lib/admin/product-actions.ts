"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { listCategories } from "../shop/categories";
import { requirePermission } from "./access";
import {
  type FormErrors,
  parseProductDetails,
  parseProductForm,
  parseStockGrid,
} from "./product-form";
import {
  existingOption2,
  saveProduct,
  saveProductDetails,
  saveProductStock,
  setProductWithdrawn,
} from "./products";

export type ProductFormState = {
  errors?: FormErrors;
  /** Current stock of cells that changed while the owner was editing, by variant. */
  stockNow?: Record<string, number>;
};

/**
 * Saves a product. PRODUCTS_EDIT.
 *
 * `part` says which form sent it: "all" creates a product (details and grid
 * together, since a product with no stock can't be sold), "details" is the
 * Details tab, "stock" is the Stock tab. Each tab saves only its own part.
 *
 * On success the page is reloaded rather than the form kept: new cells now
 * have variant ids and fresh stock, and a form still holding the old ones
 * would clash with itself on the next save.
 */
export async function saveProductAction(
  _previous: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const fields = Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const productId = fields.productId || null;
  const part = productId ? fields.part : "all";

  if (part === "details" && productId) {
    const parsed = parseProductDetails({ fields, categories: await listCategories() });
    if (!parsed.ok) return { errors: parsed.errors };

    const result = await saveProductDetails({
      productId,
      details: parsed.details,
      actorId: user.id,
    });
    if (!result.ok) return { errors: result.errors };

    revalidateShop(result.slug, productId);
    redirect(`/admin/products/${productId}?notice=saved`);
  }

  if (part === "stock" && productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { priceCents: true, categoryRef: true },
    });
    if (!product) return { errors: { grid: "This product no longer exists." } };

    const parsed = parseStockGrid({
      grid: fields.grid ?? "",
      category: product.categoryRef,
      existingOption2: await existingOption2(productId),
      baseCents: product.priceCents,
    });
    if (!parsed.ok) return { errors: parsed.errors };

    const result = await saveProductStock({ productId, grid: parsed.grid, actorId: user.id });
    if (!result.ok) return { errors: result.errors, stockNow: result.stockNow };

    revalidateShop(result.slug, productId);
    redirect(
      `/admin/products/${productId}/stock?notice=saved${result.kept > 0 ? `&kept=${result.kept}` : ""}`,
    );
  }

  // Creating: details and grid together.
  const parsed = parseProductForm({
    fields,
    grid: fields.grid ?? "",
    categories: await listCategories(),
  });
  if (!parsed.ok) return { errors: parsed.errors };

  const result = await saveProduct({ productId: null, draft: parsed.draft, actorId: user.id });
  if (!result.ok) return { errors: result.errors, stockNow: result.stockNow };

  revalidateShop(result.slug, result.id);
  // Photos next: they can only be added once the product exists.
  redirect(`/admin/products/${result.id}/photos?notice=created`);
}

/** Takes a product off the shop, or puts it back. PRODUCTS_EDIT. */
export async function setProductWithdrawnAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const productId = String(formData.get("productId") ?? "");
  const withdrawn = formData.get("withdrawn") === "true";

  const result = await setProductWithdrawn({ productId, withdrawn, actorId: user.id });
  if (result.slug) revalidateShop(result.slug, productId);

  redirect(`/admin/products/${productId}?notice=${withdrawn ? "withdrawn" : "restored"}`);
}

/** The catalogue, the product's page, the admin list and every tab of the product. */
function revalidateShop(slug: string, productId: string): void {
  revalidatePath("/");
  revalidatePath(`/products/${slug}`);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`, "layout");
}
