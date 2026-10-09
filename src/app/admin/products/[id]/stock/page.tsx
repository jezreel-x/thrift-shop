import { notFound } from "next/navigation";

import { Notice } from "@/components/admin/notice";
import { ProductForm } from "@/components/admin/product-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { CONDITION_OPTIONS, GENDER_OPTIONS } from "@/lib/admin/product-options";
import { getProductForEdit } from "@/lib/admin/products";
import { prisma } from "@/lib/prisma";
import { listCategories } from "@/lib/shop/categories";

type Props = PageProps<"/admin/products/[id]/stock">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { title: true } });

  return `Stock · ${product?.title ?? "Product"}`;
}, Permission.PRODUCTS_EDIT);

/** The Stock tab: colours, the colour × size grid, and its prices. */
export default async function ProductStockGridPage({ params, searchParams }: Props) {
  const { id } = await params;
  await requirePermission(Permission.PRODUCTS_EDIT, `/admin/products/${id}/stock`);

  const [product, categories, query] = await Promise.all([
    getProductForEdit(id),
    listCategories(),
    searchParams,
  ]);
  if (!product) notFound();

  const kept = typeof query.kept === "string" && /^\d+$/.test(query.kept) ? Number(query.kept) : 0;

  return (
    <>
      {query.notice === "saved" && (
        <Notice>
          Saved.
          {kept > 0 &&
            ` ${kept === 1 ? "One size you cleared is" : `${kept} sizes you cleared are`} on past orders, so ${kept === 1 ? "it was" : "they were"} kept at 0 rather than removed.`}
        </Notice>
      )}

      <ProductForm
        // A fresh grid after each save: new cells now have ids and fresh stock.
        key={product.version}
        part="stock"
        initial={product}
        categories={categories}
        conditions={CONDITION_OPTIONS}
        genders={GENDER_OPTIONS}
      />
    </>
  );
}
