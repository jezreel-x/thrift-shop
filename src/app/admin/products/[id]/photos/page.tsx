import { notFound } from "next/navigation";

import { Notice } from "@/components/admin/notice";
import { ProductPhotos } from "@/components/admin/product-photos";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { listPhotos } from "@/lib/admin/photos";
import { prisma } from "@/lib/prisma";

type Props = PageProps<"/admin/products/[id]/photos">;

export const generateMetadata = staffTitle<Props>(async ({ params }) => {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { title: true } });

  return `Photos · ${product?.title ?? "Product"}`;
}, Permission.PRODUCTS_EDIT);

/** The Photos tab. Where a new product lands, since photos need it to exist. */
export default async function ProductPhotosPage({ params, searchParams }: Props) {
  const { id } = await params;
  await requirePermission(Permission.PRODUCTS_EDIT, `/admin/products/${id}/photos`);

  const [product, photos, query] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      select: {
        categoryRef: { select: { option1Name: true } },
        swatches: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, hex: true },
        },
      },
    }),
    listPhotos(id),
    searchParams,
  ]);
  if (!product) notFound();

  const colourLabel = product.categoryRef.option1Name;

  return (
    <>
      {query.notice === "created" && (
        <Notice>Created, and it&apos;s on the shop. Add its photos here.</Notice>
      )}

      <ProductPhotos
        productId={id}
        photos={photos}
        // Saved colours only: a photo can be tagged with a colour once it exists.
        swatches={colourLabel ? product.swatches : []}
        colourLabel={colourLabel ?? "Colour"}
      />
    </>
  );
}
