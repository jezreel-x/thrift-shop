import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Category, Condition, Gender, ProductStatus } from "../src/generated/prisma/enums";
import { isValidSize } from "../src/lib/catalogue";
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
 * A handful of items are marked SOLD and RESERVED rather than leaving everything
 * available, because "every item is one of one" is the shop's whole premise and
 * a catalogue where nothing has ever sold fails to show it.
 */

const MANIFEST_PATH = join("prisma", "seed-manifest.json");

/** Every nth item is marked sold, and every nth+1 reserved. */
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

type ManifestItem = {
  slug: string;
  category: Category;
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

  validate(items);

  let created = 0;
  let updated = 0;

  for (const [index, item] of items.entries()) {
    const status = statusFor(index);

    const existing = await prisma.product.findUnique({ where: { slug: item.slug } });

    const data = {
      slug: item.slug,
      title: item.title,
      description: item.description,
      brand: item.brand,
      priceCents: item.priceCents,
      size: item.size,
      category: item.category,
      condition: item.condition,
      gender: item.gender,
      status,
      // A reservation without an expiry is an item lost from the catalogue, so
      // the seeded one is given a live hold rather than an open-ended flag.
      reservedUntil:
        status === ProductStatus.RESERVED ? new Date(Date.now() + 15 * 60 * 1000) : null,
    };

    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      create: data,
      update: data,
    });

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
      await prisma.productStatusHistory.create({
        data: { productId: product.id, toStatus: status, reason: "seeded" },
      });
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
function validate(items: ManifestItem[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.slug)) problems.push(`${item.slug}: duplicated slug`);
    seen.add(item.slug);

    if (item.priceCents <= 0) problems.push(`${item.slug}: priceCents is ${item.priceCents}`);
    if (!Number.isInteger(item.priceCents)) {
      problems.push(`${item.slug}: priceCents must be whole cents, got ${item.priceCents}`);
    }
    if (!isValidSize(item.category, item.size)) {
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

function statusFor(index: number): ProductStatus {
  const position = index + 1;

  if (position % SOLD_EVERY === 0) return ProductStatus.SOLD;
  if (position % RESERVED_EVERY === 0) return ProductStatus.RESERVED;

  return ProductStatus.AVAILABLE;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
