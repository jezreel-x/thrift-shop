"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { listCategories } from "../shop/categories";
import { requirePermission } from "./access";
import { type FormErrors, parseProductForm } from "./product-form";
import { existingOption2, saveProduct, setProductWithdrawn } from "./products";

export type ProductFormState = {
  errors?: FormErrors;
  /** Current stock of cells that changed while the owner was editing, by variant. */
  stockNow?: Record<string, number>;
};

/**
 * Creates or saves a product with its stock grid. PRODUCTS_EDIT.
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

  const parsed = parseProductForm({
    fields,
    grid: fields.grid ?? "",
    categories: await listCategories(),
    existingOption2: productId ? await existingOption2(productId) : [],
  });
  if (!parsed.ok) return { errors: parsed.errors };

  const result = await saveProduct({ productId, draft: parsed.draft, actorId: user.id });
  if (!result.ok) return { errors: result.errors, stockNow: result.stockNow };

  revalidateShop(result.slug);

  const notice = productId ? "saved" : "created";
  redirect(
    `/admin/products/${result.id}?notice=${notice}${result.kept > 0 ? `&kept=${result.kept}` : ""}`,
  );
}

/** Takes a product off the shop, or puts it back. PRODUCTS_EDIT. */
export async function setProductWithdrawnAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const productId = String(formData.get("productId") ?? "");
  const withdrawn = formData.get("withdrawn") === "true";

  const result = await setProductWithdrawn({ productId, withdrawn, actorId: user.id });
  if (result.slug) revalidateShop(result.slug);

  redirect(`/admin/products/${productId}?notice=${withdrawn ? "withdrawn" : "restored"}`);
}

/** The catalogue, the product's page and the admin list all show what changed. */
function revalidateShop(slug: string): void {
  revalidatePath("/");
  revalidatePath(`/products/${slug}`);
  revalidatePath("/admin/products");
}
