import { Condition, Gender } from "@/generated/prisma/enums";
import { normaliseCategorySlug } from "@/lib/shop/categories";
import { db } from "./db";

/**
 * Test products, each with the variant the shop actually sells.
 *
 * A thrift item by default: one variant, size M, one unit. Pass `stock` for
 * shop stock, `stock: 0` for something sold out.
 */

let sequence = 0;

export type TestProduct = Awaited<ReturnType<typeof makeProduct>>;

export async function makeProduct(
  overrides: Record<string, unknown> = {},
  variant: { stock?: number; option2?: string | null; priceCents?: number | null } = {},
) {
  sequence += 1;
  const option2 = variant.option2 === undefined ? "M" : variant.option2;
  const { category = "hoodies", ...fields } = overrides as { category?: string };

  const product = await db.product.create({
    data: {
      slug: `product-${sequence}`,
      title: `Product ${sequence}`,
      priceCents: 150_000,
      condition: Condition.GOOD,
      gender: Gender.UNISEX,
      ...fields,
      categoryId: await categoryIdFor(category),
    },
  });

  const created = await db.productVariant.create({
    data: {
      productId: product.id,
      option2,
      stock: variant.stock ?? 1,
      priceCents: variant.priceCents ?? null,
    },
  });

  return { ...product, variantId: created.id };
}

/** Units of a variant still on the shelf. */
export async function stockOf(variantId: string): Promise<number> {
  return (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
}

/**
 * A category's id from its slug ("t-shirts"), or the old way of naming it
 * ("T_SHIRTS"), which reads as the same slug.
 */
export async function categoryIdFor(category: string): Promise<string> {
  const row = await db.productCategory.findUniqueOrThrow({
    where: { slug: normaliseCategorySlug(category) },
  });

  return row.id;
}
