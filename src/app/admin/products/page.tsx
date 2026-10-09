import { ImageOff, Plus, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { can } from "@/lib/admin/permissions";
import { parseProductQuery, productListHref } from "@/lib/admin/product-query";
import { type AdminProductRow, listAdminProducts } from "@/lib/admin/products";
import { formatAge, formatDateTime } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { listCategories } from "@/lib/shop/categories";

export const generateMetadata = staffTitle("Products", Permission.PRODUCTS_VIEW);

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { access } = await requirePermission(Permission.PRODUCTS_VIEW, "/admin/products");
  const canEdit = can(access, Permission.PRODUCTS_EDIT);

  const categories = await listCategories();
  const query = parseProductQuery(
    await searchParams,
    categories.map((category) => category.slug),
  );
  const { products, total, pageCount } = await listAdminProducts({
    search: query.search,
    categoryId: categories.find((category) => category.slug === query.category)?.id ?? null,
    withdrawn: query.withdrawn,
    page: query.page,
  });
  const filtered = Boolean(query.search || query.category);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted">
            What&apos;s on the shop, with stock across every colour and size.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <Plus aria-hidden className="size-4" />
            New product
          </Link>
        )}
      </div>

      <nav aria-label="Which products" className="mt-6">
        <ul className="inline-flex gap-1 rounded-xl border border-border bg-surface-muted/50 p-1">
          {[
            { label: "On the shop", withdrawn: false },
            { label: "Taken off", withdrawn: true },
          ].map((tab) => {
            const active = tab.withdrawn === query.withdrawn;

            return (
              <li key={tab.label}>
                <Link
                  href={productListHref({ ...query, withdrawn: tab.withdrawn, page: 1 })}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-4 py-2 text-sm whitespace-nowrap transition ${
                    active
                      ? "bg-surface font-medium text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* A plain GET form: the view lands in the URL, and works without JavaScript. */}
      <form action="/admin/products" className="mt-4 flex flex-wrap gap-2">
        {query.withdrawn && <input type="hidden" name="show" value="withdrawn" />}
        <label className="relative min-w-48 flex-1 sm:max-w-sm">
          <span className="sr-only">Search products</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Name or brand"
            className="w-full rounded-lg border border-border bg-transparent py-2 pr-3 pl-9 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select
            name="category"
            defaultValue={query.category}
            className="h-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm transition hover:bg-surface-muted"
        >
          Search
        </button>
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
        {products.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted">
            {filtered
              ? "No products match. Try another name, or all categories."
              : query.withdrawn
                ? "Nothing has been taken off the shop."
                : "No products yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {products.map((product) => (
              <li key={product.id}>
                <ProductRow
                  product={product}
                  // Without PRODUCTS_EDIT there is no form to open; the stock page,
                  // where sales and holds are recorded, needs only PRODUCTS_VIEW.
                  href={`/admin/products/${product.id}${canEdit ? "" : "/sales"}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <p className="tabular-nums">
            {total} {total === 1 ? "product" : "products"}
          </p>
          {pageCount > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-2">
              <PageLink
                href={productListHref({ ...query, page: query.page - 1 })}
                disabled={query.page <= 1}
              >
                Previous
              </PageLink>
              <span className="tabular-nums">
                Page {Math.min(query.page, pageCount)} of {pageCount}
              </span>
              <PageLink
                href={productListHref({ ...query, page: query.page + 1 })}
                disabled={query.page >= pageCount}
              >
                Next
              </PageLink>
            </nav>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * One product: photo, name, what it comes in, stock and price. One line on a
 * laptop; stock and price drop under the name on a phone.
 */
function ProductRow({ product, href }: { product: AdminProductRow; href: string }) {
  const { swatches, variants } = product.options;
  const options =
    variants <= 1
      ? "One option"
      : swatches > 1
        ? `${swatches} colours · ${variants} combinations`
        : `${variants} sizes`;

  return (
    <Link
      href={href}
      className="flex items-center gap-4 p-3 transition hover:bg-surface-muted/50 sm:px-4"
    >
      {product.thumbnail ? (
        <Image
          src={product.thumbnail.url}
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-lg border border-border object-cover"
        />
      ) : (
        <span className="grid size-14 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted">
          <ImageOff aria-hidden className="size-5" />
          <span className="sr-only">No photo</span>
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{product.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {[product.category, product.brand, options].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-1 flex gap-3 text-xs sm:hidden">
          <StockLabel stock={product.stock} />
          <span className="tabular-nums">{priceLabel(product)}</span>
        </span>
      </span>

      <span className="hidden w-28 text-sm sm:block">
        <StockLabel stock={product.stock} />
      </span>
      <span className="hidden w-32 text-right text-sm tabular-nums sm:block">
        {priceLabel(product)}
      </span>
      <span
        className="hidden w-24 text-right text-xs text-muted md:block"
        title={formatDateTime(product.updatedAt)}
      >
        {formatAge(product.updatedAt)}
      </span>
    </Link>
  );
}

function StockLabel({ stock }: { stock: number }) {
  return stock === 0 ? (
    <span className="font-medium text-red-700 dark:text-red-300">Sold out</span>
  ) : (
    <span className="tabular-nums">{stock} in stock</span>
  );
}

function priceLabel(product: AdminProductRow): string {
  return `${product.priceVaries ? "From " : ""}${formatPrice(product.fromPriceCents)}`;
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "rounded-md border border-border px-3 py-1.5 text-xs";

  return disabled ? (
    <span aria-disabled="true" className={`${className} opacity-40`}>
      {children}
    </span>
  ) : (
    <Link
      href={href}
      className={`${className} transition hover:bg-surface-muted hover:text-foreground`}
    >
      {children}
    </Link>
  );
}
