import { Category, Condition, Gender } from "@/generated/prisma/enums";
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

  const product = await db.product.create({
    data: {
      slug: `product-${sequence}`,
      title: `Product ${sequence}`,
      priceCents: 150_000,
      // Still required until the contract migration; nothing reads it.
      size: option2 ?? "M",
      category: Category.HOODIES,
      condition: Condition.GOOD,
      gender: Gender.UNISEX,
      ...overrides,
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
