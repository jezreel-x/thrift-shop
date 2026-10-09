import { ArrowLeft, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductTabs } from "@/components/admin/product-tabs";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { can } from "@/lib/admin/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Every product tab: the way back, the product, and the tabs.
 *
 * Checks access itself rather than relying on the tab beneath it. A layout
 * still renders when its page answers 404, so without its own check it would
 * show the product's name to anyone who typed the address.
 */
export default async function ProductLayout({
  params,
  children,
}: LayoutProps<"/admin/products/[id]">) {
  const { id } = await params;
  const { access } = await requirePermission(Permission.PRODUCTS_VIEW, `/admin/products/${id}`);

  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      title: true,
      slug: true,
      deletedAt: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
    },
  });
  if (!product) notFound();

  const base = `/admin/products/${id}`;
  // Staff who can't edit products have only the tab for recording sales and holds.
  const tabs = can(access, Permission.PRODUCTS_EDIT)
    ? [
        { href: base, label: "Details" },
        { href: `${base}/photos`, label: "Photos" },
        { href: `${base}/stock`, label: "Stock" },
        { href: `${base}/sales`, label: "Sales & holds" },
      ]
    : [{ href: `${base}/sales`, label: "Sales & holds" }];
  const thumbnail = product.images[0];

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Products
      </Link>

      <div className="mt-3 flex items-center gap-4">
        {thumbnail && (
          <Image
            src={thumbnail.url}
            alt={thumbnail.alt ?? product.title}
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{product.title}</h1>
          {product.deletedAt ? (
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-400">
              Off the shop. Buyers can&apos;t see it.
            </p>
          ) : (
            <Link
              href={`/products/${product.slug}`}
              target="_blank"
              className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
            >
              View on the shop
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          )}
        </div>
      </div>

      <ProductTabs tabs={tabs} />

      <div className="mt-8">{children}</div>
    </main>
  );
}
