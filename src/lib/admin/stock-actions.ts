"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Permission } from "@/generated/prisma/enums";
import { prisma } from "../prisma";
import { requirePermission } from "./access";
import {
  type HoldDuration,
  type StockResult,
  holdForWhatsApp,
  markSoldElsewhere,
  releaseWhatsAppHold,
  sellWhatsAppHold,
} from "./stock";

/**
 * The stock page's buttons. Small forms that redirect back with what
 * happened in the address, so each works without JavaScript and a refresh
 * never repeats it.
 *
 * Each checks its own permission: a shop assistant may be allowed to mark
 * things sold or hold them for a chat without being allowed to edit products.
 */

export async function soldElsewhereAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_MARK_SOLD);

  const result = await markSoldElsewhere({
    variantId: field(formData, "variantId"),
    quantity: Number(field(formData, "quantity") || "1"),
    actorId: user.id,
  });

  await finish(formData, result, "sold");
}

export async function holdForWhatsAppAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_HOLD);

  const result = await holdForWhatsApp({
    variantId: field(formData, "variantId"),
    quantity: Number(field(formData, "quantity") || "1"),
    note: field(formData, "note"),
    duration: field(formData, "duration") as HoldDuration,
    actorId: user.id,
  });

  await finish(formData, result, "held");
}

/** Selling takes units out of stock, so it is "mark sold", not "hold". */
export async function sellHoldAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_MARK_SOLD);

  const result = await sellWhatsAppHold({ holdId: field(formData, "holdId"), actorId: user.id });

  await finish(formData, result, "sold-hold");
}

export async function releaseHoldAction(formData: FormData): Promise<void> {
  const { user } = await requirePermission(Permission.PRODUCTS_HOLD);

  const result = await releaseWhatsAppHold({
    holdId: field(formData, "holdId"),
    actorId: user.id,
  });

  await finish(formData, result, "released");
}

/** Refreshes what changed, and goes back to the stock page saying how it went. */
async function finish(formData: FormData, result: StockResult, done: string): Promise<never> {
  // The product from the result; the form's own field only to find the way back.
  const productId = result.productId ?? field(formData, "productId");
  const params = new URLSearchParams(
    result.ok
      ? { done }
      : {
          error: result.reason,
          ...(result.free !== undefined ? { free: String(result.free) } : {}),
        },
  );

  if (result.ok) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { slug: true },
    });
    revalidatePath("/");
    if (product) revalidatePath(`/products/${product.slug}`);
    revalidatePath("/admin/products");
  }

  redirect(productId ? `/admin/products/${productId}/stock?${params}` : "/admin/products");
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
