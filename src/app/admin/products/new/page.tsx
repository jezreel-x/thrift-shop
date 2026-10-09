import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ProductForm } from "@/components/admin/product-form";
import { Permission } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/admin/access";
import { staffTitle } from "@/lib/admin/metadata";
import { CONDITION_OPTIONS, GENDER_OPTIONS } from "@/lib/admin/product-options";
import { EMPTY_PRODUCT } from "@/lib/admin/products";
import { listCategories } from "@/lib/shop/categories";

export const generateMetadata = staffTitle("New product", Permission.PRODUCTS_EDIT);

export default async function NewProductPage() {
  await requirePermission(Permission.PRODUCTS_EDIT, "/admin/products/new");

  const categories = await listCategories();

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Products
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New product</h1>
      <p className="mt-1 text-sm text-muted">
        It goes live on the shop as soon as you create it with stock. Photos come next, on the
        product&apos;s Photos tab.
      </p>

      <div className="mt-8">
        <ProductForm
          initial={EMPTY_PRODUCT}
          categories={categories}
          conditions={CONDITION_OPTIONS}
          genders={GENDER_OPTIONS}
        />
      </div>
    </main>
  );
}
