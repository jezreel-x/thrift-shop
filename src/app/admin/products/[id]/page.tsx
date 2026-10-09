import { notFound } from "next/navigation";

import { Notice } from "@/components/admin/notice";
import { ProductForm } from "@/components/admin/product-form";
import { WithdrawProduct } from "@/components/admin/withdraw-product";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { CONDITION_OPTIONS, GENDER_OPTIONS } from "@/lib/admin/product-options";
import { getProductForEdit } from "@/lib/admin/products";
import { prisma } from "@/lib/prisma";
import { listCategories } from "@/lib/shop/categories";

type Props = PageProps<"/admin/products/[id]">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { title: true } });

  return product?.title ?? "Product";
}, Permission.PRODUCTS_EDIT);

const NOTICES: Record<string, string> = {
  saved: "Saved.",
  withdrawn: "Taken off the shop.",
  restored: "Back on the shop.",
};

/** The Details tab: name, category, price and the rest; and taking it off the shop. */
export default async function ProductDetailsPage({ params, searchParams }: Props) {
  const { id } = await params;
  await requirePermission(Permission.PRODUCTS_EDIT, `/admin/products/${id}`);

  const [product, categories, query] = await Promise.all([
    getProductForEdit(id),
    listCategories(),
    searchParams,
  ]);
  if (!product) notFound();

  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      {notice && <Notice>{notice}</Notice>}

      <ProductForm
        // A fresh form after each save.
        key={product.version}
        part="details"
        initial={product}
        categories={categories}
        conditions={CONDITION_OPTIONS}
        genders={GENDER_OPTIONS}
      />

      <div className="mt-12">
        <WithdrawProduct productId={product.id!} withdrawn={product.withdrawn} />
      </div>
    </>
  );
}
