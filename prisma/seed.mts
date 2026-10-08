import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Condition, Gender } from "../src/generated/prisma/enums";
import { normaliseCategorySlug, offersOption2 } from "../src/lib/shop/categories";
import { prisma } from "../src/lib/prisma";

/**
 * Creates the catalogue from prisma/seed-manifest.json.
 *
 *   npm run seed
 *
 * The manifest is written by `npm run seed:upload`, which handles the images.
 * This step only writes rows, so it is safe to re-run while adjusting prices and
 * sizes by hand: products are matched on slug and updated in place, and their
 * images are replaced to match the manifest.
 *
 * A handful of items are sold out or held rather than leaving everything
 * available: a catalogue where nothing has ever sold doesn't show what the
 * shop is like.
 */

const MANIFEST_PATH = join("prisma", "seed-manifest.json");

/** Every nth item is sold out, and every mth held in a checkout. */
const SOLD_EVERY = 7;
const RESERVED_EVERY = 11;

type ManifestImage = {
  url: string;
  pathname: string;
  checksum: string;
  width: number;
  height: number;
  alt: string;
};

/** How a seeded item starts out. */
type SeedState = "available" | "sold" | "held";

type ManifestItem = {
  slug: string;
  /** The category the old way (HOODIES), read as its slug (hoodies). */
  category: string;
  title: string;
  description: string | null;
  brand: string | null;
  priceCents: number;
  size: string;
  condition: Condition;
  gender: Gender;
  images: ManifestImage[];
};

async function main() {
  const items = await readManifest();

  // Categories are data, created by the migration; the manifest still names
  // them the old way (HOODIES), which reads as the slug "hoodies".
  const categories = new Map(
    (await prisma.productCategory.findMany()).map((category) => [category.slug, category]),
  );
  const categoryOf = (item: ManifestItem) => categories.get(normaliseCategorySlug(item.category));

  validate(items, categoryOf);

  let created = 0;
  let updated = 0;

  for (const [index, item] of items.entries()) {
    const state = stateFor(index);

    const existing = await prisma.product.findUnique({ where: { slug: item.slug } });

    const data = {
      slug: item.slug,
      title: item.title,
      description: item.description,
      brand: item.brand,
      priceCents: item.priceCents,
      // validate() has made sure every item has one.
      categoryId: categoryOf(item)!.id,
      condition: item.condition,
      gender: item.gender,
    };

    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      create: data,
      update: data,
    });

    // One variant per thrift item: its size, one unit unless it has sold.
    const stock = state === "sold" ? 0 : 1;
    const variant =
      (await prisma.productVariant.findFirst({ where: { productId: product.id } })) ??
      (await prisma.productVariant.create({
        data: { productId: product.id, option2: item.size, stock },
      }));
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { option2: item.size, stock },
    });
    await prisma.stockHold.deleteMany({ where: { variantId: variant.id } });
    if (state === "held") {
      // A short, real hold, so the Reserved badge shows for a while after
      // seeding and then lapses exactly as a buyer's would.
      await prisma.stockHold.create({
        data: {
          variantId: variant.id,
          holder: "seed",
          quantity: 1,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
    }

    // Images are replaced wholesale rather than reconciled. The manifest is the
    // source of truth, this runs only against seed data, and a diff would be
    // more code than the problem deserves.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.createMany({
      data: item.images.map((image, position) => ({
        productId: product.id,
        url: image.url,
        pathname: image.pathname,
        checksum: image.checksum,
        width: image.width,
        height: image.height,
        alt: image.alt,
        position,
      })),
    });

    // Only on first creation: re-seeding should not fabricate a second arrival
    // for an item that has been in the catalogue all along.
    if (!existing) {
      if (stock > 0) {
        await prisma.stockMovement.create({
          data: { variantId: variant.id, change: stock, reason: "opening stock" },
        });
      }
      created += 1;
    } else {
      updated += 1;
    }
  }

  const photos = items.reduce((total, item) => total + item.images.length, 0);
  console.log(
    `Seeded ${items.length} items (${created} new, ${updated} updated), ${photos} photos.`,
  );
}

async function readManifest(): Promise<ManifestItem[]> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ManifestItem[];
  } catch {
    throw new Error(
      `Could not read ${MANIFEST_PATH}. Put the photographs in seed-images/ and run ` +
        `\`npm run seed:upload\` first — see seed-images/README.md.`,
    );
  }
}

/**
 * Refuses a manifest that would produce a catalogue nobody can browse.
 *
 * These are the mistakes that come from editing JSON by hand, and every one of
 * them is silent if it reaches the database: a size the filter cannot match, a
 * duplicate slug overwriting a different garment, an item priced at nothing.
 */
function validate(
  items: ManifestItem[],
  categoryOf: (item: ManifestItem) => { option2Values: string[] } | undefined,
): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.slug)) problems.push(`${item.slug}: duplicated slug`);
    seen.add(item.slug);

    if (item.priceCents <= 0) problems.push(`${item.slug}: priceCents is ${item.priceCents}`);
    if (!Number.isInteger(item.priceCents)) {
      problems.push(`${item.slug}: priceCents must be whole cents, got ${item.priceCents}`);
    }
    const category = categoryOf(item);
    if (!category) {
      problems.push(`${item.slug}: no category "${item.category}" in the database`);
    } else if (!offersOption2(category, item.size)) {
      problems.push(`${item.slug}: "${item.size}" is not a size offered for ${item.category}`);
    }
    if (item.images.length === 0) problems.push(`${item.slug}: no images`);
  }

  if (problems.length > 0) {
    throw new Error(
      `${MANIFEST_PATH} is not ready:\n  ${problems.join("\n  ")}\n\n` +
        `Fill in the missing details, then run \`npm run seed\` again.`,
    );
  }
}

function stateFor(index: number): SeedState {
  const position = index + 1;

  if (position % SOLD_EVERY === 0) return "sold";
  if (position % RESERVED_EVERY === 0) return "held";

  return "available";
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
