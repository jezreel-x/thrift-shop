"use server";

import { revalidatePath } from "next/cache";

import { Permission } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { requirePermission } from "./access";
import {
  PHOTO_REFUSALS,
  type PhotoMove,
  attachPhoto,
  movePhoto,
  removePhoto,
  updatePhoto,
} from "./photos";

/**
 * Photo changes. PRODUCTS_EDIT, like the rest of the product form.
 *
 * Attaching is called by the uploader once the file is in storage; the rest
 * are small forms beside each photo, and work without JavaScript.
 */

export async function attachPhotoAction(input: {
  productId: string;
  swatchId: string | null;
  pathname: string;
  width: number;
  height: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const result = await attachPhoto({ ...input, actorId: user.id });
  if (!result.ok) return { ok: false, error: PHOTO_REFUSALS[result.reason] };

  await revalidateProduct(input.productId);

  return { ok: true };
}

export async function updatePhotoAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const result = await updatePhoto({
    imageId: String(formData.get("imageId") ?? ""),
    swatchId: String(formData.get("swatchId") ?? "") || null,
    alt: String(formData.get("alt") ?? ""),
    actorId: user.id,
  });
  if (result.productId) await revalidateProduct(result.productId);
}

export async function movePhotoAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const move = String(formData.get("move") ?? "");
  if (move !== "earlier" && move !== "later" && move !== "first") return;

  const result = await movePhoto({
    imageId: String(formData.get("imageId") ?? ""),
    move: move satisfies PhotoMove,
    actorId: user.id,
  });
  if (result.productId) await revalidateProduct(result.productId);
}

export async function removePhotoAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_EDIT);

  const result = await removePhoto({
    imageId: String(formData.get("imageId") ?? ""),
    actorId: user.id,
  });
  if (result.productId) await revalidateProduct(result.productId);
}

/** The edit page, the list's thumbnail, the catalogue card and the product page. */
async function revalidateProduct(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  revalidatePath("/");
  if (product) revalidatePath(`/products/${product.slug}`);
}
