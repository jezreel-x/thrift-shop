import { Category, Condition, Gender } from "@/generated/prisma/enums";
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
  const category = (overrides.category as Category | undefined) ?? Category.HOODIES;

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
      // Linked to its row, as the migration links real products.
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

/** The category row the migration created for an old enum value. */
export async function categoryIdFor(category: Category): Promise<string> {
  const row = await db.productCategory.findUniqueOrThrow({
    where: { slug: normaliseCategorySlug(category) },
  });

  return row.id;
}
