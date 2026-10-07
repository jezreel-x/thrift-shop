import { ArrowLeft, Boxes, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductForm } from "@/components/admin/product-form";
import { ProductPhotos } from "@/components/admin/product-photos";
import { WithdrawProduct } from "@/components/admin/withdraw-product";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { listPhotos } from "@/lib/admin/photos";
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
  created: "Created. It's on the shop now.",
  saved: "Saved.",
  withdrawn: "Taken off the shop.",
  restored: "Back on the shop.",
};

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  await requirePermission(Permission.PRODUCTS_EDIT, `/admin/products/${id}`);

  const [product, categories, photos, query] = await Promise.all([
    getProductForEdit(id),
    listCategories(),
    listPhotos(id),
    searchParams,
  ]);
  if (!product) notFound();

  const category = categories.find((candidate) => candidate.id === product.categoryId);
  // Saved colours only: a photo can be tagged with a colour once it exists.
  const swatches = product.grid.swatches.map((swatch) => ({
    id: swatch.key,
    name: swatch.name,
    hex: swatch.hex || null,
  }));

  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const kept = typeof query.kept === "string" && /^\d+$/.test(query.kept) ? Number(query.kept) : 0;

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Products
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {product.thumbnail && (
          <Image
            src={product.thumbnail.url}
            alt={product.thumbnail.alt}
            width={56}
            height={56}
            className="size-14 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{product.title}</h1>
          <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <Link
              href={`/admin/products/${product.id}/stock`}
              className="inline-flex items-center gap-1 transition hover:text-foreground"
            >
              <Boxes aria-hidden className="size-3.5" />
              Stock &amp; holds
            </Link>
            {product.withdrawn ? (
              <span className="text-amber-700 dark:text-amber-400">
                Off the shop. Buyers can&apos;t see it.
              </span>
            ) : (
              <Link
                href={`/products/${product.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                View on the shop
                <ExternalLink aria-hidden className="size-3.5" />
              </Link>
            )}
          </p>
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          {notice}
          {kept > 0 &&
            ` ${kept === 1 ? "One size you cleared is" : `${kept} sizes you cleared are`} on past orders, so ${kept === 1 ? "it was" : "they were"} kept at 0 rather than removed.`}
        </p>
      )}

      <div className="mt-8">
        <ProductPhotos
          productId={product.id!}
          photos={photos}
          swatches={category?.option1Name ? swatches : []}
          colourLabel={category?.option1Name ?? "Colour"}
        />
      </div>

      <div className="mt-12">
        <ProductForm
          // A fresh form after each save: new cells now have ids and stock.
          key={product.version}
          initial={product}
          categories={categories}
          conditions={CONDITION_OPTIONS}
          genders={GENDER_OPTIONS}
        />
      </div>

      <div className="mt-12">
        <WithdrawProduct productId={product.id!} withdrawn={product.withdrawn} />
      </div>
    </main>
  );
}
