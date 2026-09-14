import { beforeEach, describe, expect, it } from "vitest";

import { Category, Condition, Gender, ProductStatus } from "@/generated/prisma/enums";
import { db, cleanDatabaseBetweenTests } from "@/test/db";
import { PAGE_SIZE, getProductBySlug, listProductSlugs, listProducts } from "./products";

cleanDatabaseBetweenTests();

let sequence = 0;

/**
 * Inserts a product, filling in whatever the test does not care about.
 *
 * `createdAt` defaults to a fixed instant rather than now(), so insertion order
 * never leaks into assertions about sorting — a test that passes because rows
 * happened to be written in the right order is a test that proves nothing.
 */
async function makeProduct(
  overrides: Partial<Parameters<typeof db.product.create>[0]["data"]> = {},
) {
  sequence += 1;

  return db.product.create({
    data: {
      slug: `product-${sequence}`,
      title: `Product ${sequence}`,
      priceCents: 100_000,
      size: "M",
      category: Category.T_SHIRTS,
      condition: Condition.GOOD,
      gender: Gender.UNISEX,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    },
  });
}

beforeEach(() => {
  sequence = 0;
});

describe("listProducts — what is visible", () => {
  it("excludes soft-deleted products", async () => {
    await makeProduct({ slug: "visible" });
    await makeProduct({ slug: "binned", deletedAt: new Date() });

    const { items, total } = await listProducts();

    expect(items.map((item) => item.slug)).toEqual(["visible"]);
    expect(total).toBe(1);
  });

  it("includes sold and reserved items rather than hiding them", async () => {
    await makeProduct({ slug: "sold", status: ProductStatus.SOLD });
    await makeProduct({ slug: "reserved", status: ProductStatus.RESERVED });
    await makeProduct({ slug: "available", status: ProductStatus.AVAILABLE });

    const { items } = await listProducts();

    expect(items.map((item) => item.slug).sort()).toEqual(["available", "reserved", "sold"]);
  });

  it("ranks available above reserved above sold", async () => {
    // Inserted worst-first so passing cannot be an accident of insertion order.
    // This also pins a real coupling: Postgres sorts an enum by declaration
    // order, so reordering ProductStatus in the schema would silently float
    // sold items to the top of every page.
    await makeProduct({ slug: "sold", status: ProductStatus.SOLD });
    await makeProduct({ slug: "reserved", status: ProductStatus.RESERVED });
    await makeProduct({ slug: "available", status: ProductStatus.AVAILABLE });

    const { items } = await listProducts();

    expect(items.map((item) => item.slug)).toEqual(["available", "reserved", "sold"]);
  });

  it("keeps sold items below available ones even when sorting by price", async () => {
    await makeProduct({ slug: "cheap-sold", priceCents: 1_000, status: ProductStatus.SOLD });
    await makeProduct({ slug: "dear-available", priceCents: 900_000 });

    const { items } = await listProducts({ sort: "price-asc" });

    expect(items.map((item) => item.slug)).toEqual(["dear-available", "cheap-sold"]);
  });
});

describe("listProducts — filters", () => {
  beforeEach(async () => {
    await makeProduct({
      slug: "grey-hoodie-l",
      title: "Grey Nike hoodie",
      brand: "Nike",
      description: "Heavyweight fleece, barely worn",
      priceCents: 250_000,
      size: "L",
      category: Category.HOODIES,
      condition: Condition.EXCELLENT,
      gender: Gender.UNISEX,
    });
    await makeProduct({
      slug: "black-tee-m",
      title: "Black Adidas tee",
      brand: "Adidas",
      description: "Lightweight cotton, no marks",
      priceCents: 80_000,
      size: "M",
      category: Category.T_SHIRTS,
      condition: Condition.GOOD,
      gender: Gender.WOMENS,
    });
    await makeProduct({
      slug: "wide-leg-sweats-xl",
      title: "Wide-leg sweatpants",
      brand: null,
      description: "Faded black, minor pilling at the cuffs",
      priceCents: 600_000,
      size: "XL",
      category: Category.WIDE_LEG_SWEATPANTS,
      condition: Condition.FAIR,
      gender: Gender.MENS,
    });
  });

  it("filters by size", async () => {
    const { items } = await listProducts({ filters: { sizes: ["M"] } });

    expect(items.map((item) => item.slug)).toEqual(["black-tee-m"]);
  });

  it("treats several sizes as alternatives, not as a narrowing", async () => {
    const { items } = await listProducts({ filters: { sizes: ["M", "L"] } });

    expect(items.map((item) => item.slug).sort()).toEqual(["black-tee-m", "grey-hoodie-l"]);
  });

  it("filters by category and by condition", async () => {
    const byCategory = await listProducts({ filters: { categories: [Category.T_SHIRTS] } });
    expect(byCategory.items.map((item) => item.slug)).toEqual(["black-tee-m"]);

    const byCondition = await listProducts({ filters: { conditions: [Condition.FAIR] } });
    expect(byCondition.items.map((item) => item.slug)).toEqual(["wide-leg-sweats-xl"]);
  });

  it("filters by gender", async () => {
    const { items } = await listProducts({ filters: { genders: [Gender.WOMENS] } });

    expect(items.map((item) => item.slug)).toEqual(["black-tee-m"]);
  });

  it("treats unisex stock as its own value, not as matching everything", async () => {
    // A buyer filtering for women's stock is asking what is cut for them. Unisex
    // items are a separate answer the UI can offer alongside, not something the
    // query should silently fold in.
    const { items } = await listProducts({ filters: { genders: [Gender.MENS] } });

    expect(items.map((item) => item.slug)).toEqual(["wide-leg-sweats-xl"]);
  });

  it("filters by price range, inclusive at both ends", async () => {
    const { items } = await listProducts({
      filters: { minPriceCents: 80_000, maxPriceCents: 250_000 },
    });

    expect(items.map((item) => item.slug).sort()).toEqual(["black-tee-m", "grey-hoodie-l"]);
  });

  it("accepts a lower bound without an upper one", async () => {
    const { items } = await listProducts({ filters: { minPriceCents: 300_000 } });

    expect(items.map((item) => item.slug)).toEqual(["wide-leg-sweats-xl"]);
  });

  it("narrows when filters are combined across facets", async () => {
    const { items } = await listProducts({
      filters: { sizes: ["M", "L"], conditions: [Condition.GOOD] },
    });

    expect(items.map((item) => item.slug)).toEqual(["black-tee-m"]);
  });

  it("searches title, brand and description, ignoring case", async () => {
    const byTitle = await listProducts({ filters: { search: "HOODIE" } });
    expect(byTitle.items.map((item) => item.slug)).toEqual(["grey-hoodie-l"]);

    const byBrand = await listProducts({ filters: { search: "adidas" } });
    expect(byBrand.items.map((item) => item.slug)).toEqual(["black-tee-m"]);

    const byDescription = await listProducts({ filters: { search: "pilling" } });
    expect(byDescription.items.map((item) => item.slug)).toEqual(["wide-leg-sweats-xl"]);
  });

  it("ignores a blank search rather than matching nothing", async () => {
    const { total } = await listProducts({ filters: { search: "   " } });

    expect(total).toBe(3);
  });

  it("returns an empty page, not an error, when nothing matches", async () => {
    const { items, total, pageCount } = await listProducts({ filters: { sizes: ["XS"] } });

    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(pageCount).toBe(1);
  });
});

describe("listProducts — pagination", () => {
  it("reports the total and page count for the whole result, not the page", async () => {
    for (let i = 0; i < PAGE_SIZE + 5; i += 1) {
      await makeProduct();
    }

    const { items, total, pageCount, page } = await listProducts();

    expect(items).toHaveLength(PAGE_SIZE);
    expect(total).toBe(PAGE_SIZE + 5);
    expect(pageCount).toBe(2);
    expect(page).toBe(1);
  });

  it("never repeats or drops an item across pages when rows share a timestamp", async () => {
    // Every row here has the same createdAt. Without a tiebreaker the database
    // is free to order them differently per query, which silently duplicates
    // some items onto both pages and loses others entirely.
    for (let i = 0; i < PAGE_SIZE + 5; i += 1) {
      await makeProduct();
    }

    const first = await listProducts({ page: 1 });
    const second = await listProducts({ page: 2 });
    const slugs = [...first.items, ...second.items].map((item) => item.slug);

    expect(second.items).toHaveLength(5);
    expect(new Set(slugs).size).toBe(PAGE_SIZE + 5);
  });

  it("treats a page below 1 as the first page", async () => {
    await makeProduct();

    const { page, items } = await listProducts({ page: 0 });

    expect(page).toBe(1);
    expect(items).toHaveLength(1);
  });

  it("returns an empty page past the end rather than failing", async () => {
    await makeProduct();

    const { items, total } = await listProducts({ page: 99 });

    expect(items).toEqual([]);
    expect(total).toBe(1);
  });
});

describe("listProducts — card payload", () => {
  it("carries only the first image, by position rather than by upload order", async () => {
    const product = await makeProduct({ slug: "with-images" });
    await db.productImage.createMany({
      data: [
        {
          productId: product.id,
          url: "https://example.test/second.jpg",
          pathname: "second.jpg",
          checksum: "b",
          width: 800,
          height: 1200,
          position: 1,
        },
        {
          productId: product.id,
          url: "https://example.test/first.jpg",
          pathname: "first.jpg",
          checksum: "a",
          width: 800,
          height: 1200,
          position: 0,
        },
      ],
    });

    const { items } = await listProducts();

    expect(items[0].images).toHaveLength(1);
    expect(items[0].images[0].url).toBe("https://example.test/first.jpg");
  });

  it("returns an empty image list for a product with no photos", async () => {
    await makeProduct();

    const { items } = await listProducts();

    expect(items[0].images).toEqual([]);
  });
});

describe("getProductBySlug", () => {
  it("returns the product with every image, ordered by position", async () => {
    const product = await makeProduct({ slug: "detail" });
    await db.productImage.createMany({
      data: [2, 0, 1].map((position) => ({
        productId: product.id,
        url: `https://example.test/${position}.jpg`,
        pathname: `${position}.jpg`,
        checksum: `sum-${position}`,
        width: 800,
        height: 1200,
        position,
      })),
    });

    const found = await getProductBySlug("detail");

    expect(found?.images.map((image) => image.position)).toEqual([0, 1, 2]);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getProductBySlug("nothing-here")).toBeNull();
  });

  it("returns null for a soft-deleted product", async () => {
    await makeProduct({ slug: "binned", deletedAt: new Date() });

    expect(await getProductBySlug("binned")).toBeNull();
  });
});

describe("listProductSlugs", () => {
  it("lists live slugs and omits deleted ones", async () => {
    await makeProduct({ slug: "alive" });
    await makeProduct({ slug: "gone", deletedAt: new Date() });

    expect(await listProductSlugs()).toEqual(["alive"]);
  });
});
