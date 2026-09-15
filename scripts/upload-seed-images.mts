import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { put } from "@vercel/blob";
import sharp from "sharp";

import { Category, Condition, Gender } from "../src/generated/prisma/enums";
import { slugify } from "../src/lib/slug";

/**
 * Prepares the shop's photographs for seeding.
 *
 * Reads seed-images/<category>/<garment>/<n>.jpg, normalises each file, uploads
 * it to blob storage, and writes prisma/seed-manifest.json. The originals are
 * never committed; the manifest is, so anyone who clones the repository can seed
 * a working catalogue without them.
 *
 *   npm run seed:upload
 *
 * Re-running is safe and cheap. Uploads are addressed by content hash, so an
 * unchanged photo resolves to the same blob rather than a duplicate, and details
 * already filled into the manifest by hand are preserved.
 */

const SOURCE_DIR = "seed-images";
const MANIFEST_PATH = join("prisma", "seed-manifest.json");

/**
 * Longest edge, in pixels, of a stored image.
 *
 * A phone photograph is commonly 4000px and several megabytes. Nothing on this
 * site displays an image larger than about 1200px wide, so storing the original
 * would pay for resolution no one ever sees. 2000 leaves room for a retina
 * detail page and for cropping later.
 */
const MAX_EDGE = 2000;

/** Folder name to Category. The folders are named the way a person would name them. */
const CATEGORY_BY_FOLDER: Record<string, Category> = {
  hoodies: Category.HOODIES,
  sweatshirts: Category.SWEATSHIRTS,
  "t-shirts": Category.T_SHIRTS,
  flannels: Category.FLANNELS,
  sweatpants: Category.SWEATPANTS,
  "wide-leg-sweatpants": Category.WIDE_LEG_SWEATPANTS,
  "side-pocket-pants": Category.SIDE_POCKET_PANTS,
  underwear: Category.UNDERWEAR,
};

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

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
  requireBlobToken();

  const existing = await readManifest();
  const items: ManifestItem[] = [];

  for (const categoryFolder of await subdirectories(SOURCE_DIR)) {
    const category = CATEGORY_BY_FOLDER[categoryFolder];

    if (!category) {
      throw new Error(
        `"${categoryFolder}" is not a category. Expected one of: ` +
          `${Object.keys(CATEGORY_BY_FOLDER).join(", ")}.`,
      );
    }

    const categoryPath = join(SOURCE_DIR, categoryFolder);

    for (const garmentFolder of await subdirectories(categoryPath)) {
      const garmentPath = join(categoryPath, garmentFolder);
      const files = (await readdir(garmentPath))
        .filter((name) => IMAGE_EXTENSIONS.test(name))
        // Numeric order, so 10.jpg follows 9.jpg rather than 1.jpg.
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (files.length === 0) {
        console.warn(`  skipped ${garmentPath} — no images in it`);
        continue;
      }

      const slug = slugify(garmentFolder);
      const previous = existing.get(slug);
      const title = previous?.title ?? titleFrom(garmentFolder);

      const images: ManifestImage[] = [];
      for (const [index, file] of files.entries()) {
        images.push(await uploadOne(join(garmentPath, file), title, index));
      }

      items.push({
        slug,
        category,
        title,
        // Everything below is the shop owner's to fill in. Re-running preserves
        // whatever is already in the manifest and only refreshes the images.
        description: previous?.description ?? null,
        brand: previous?.brand ?? null,
        priceCents: previous?.priceCents ?? 0,
        size: previous?.size ?? "M",
        condition: previous?.condition ?? Condition.GOOD,
        gender: previous?.gender ?? Gender.UNISEX,
        images,
      });
    }
  }

  if (items.length === 0) {
    console.error(
      `No images found under ${SOURCE_DIR}/. See ${SOURCE_DIR}/README.md for the expected layout.`,
    );
    process.exitCode = 1;
    return;
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(items, null, 2)}\n`, "utf8");

  const photos = items.reduce((total, item) => total + item.images.length, 0);
  const unpriced = items.filter((item) => item.priceCents === 0).length;

  console.log(`\nWrote ${MANIFEST_PATH}: ${items.length} items, ${photos} photos.`);
  if (unpriced > 0) {
    console.log(`${unpriced} still need a price, size and condition. Edit the manifest, then:`);
    console.log("  npm run seed");
  }
}

/**
 * Normalises one photograph and stores it.
 *
 * Three things happen before upload, in this order for a reason. The image is
 * rotated to match its EXIF orientation and then stripped of metadata — phone
 * photos carry GPS coordinates, and these were taken in someone's home. It is
 * resized down to MAX_EDGE, never up. And it is re-encoded as WebP, which for
 * clothing photography is roughly a third the size of the equivalent JPEG.
 */
async function uploadOne(path: string, title: string, index: number): Promise<ManifestImage> {
  const original = await readFile(path);

  const normalised = await sharp(original)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const checksum = createHash("sha256").update(normalised.data).digest("hex");

  // The hash IS the path, so uploading the same photo twice overwrites one blob
  // instead of accumulating two. That makes re-running this script idempotent
  // rather than expensive.
  const pathname = `products/${checksum}.webp`;

  const blob = await put(pathname, normalised.data, {
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  const saved = Math.round((1 - normalised.data.byteLength / original.byteLength) * 100);
  console.log(`  ${path} -> ${normalised.info.width}x${normalised.info.height} (-${saved}%)`);

  return {
    url: blob.url,
    pathname,
    checksum,
    width: normalised.info.width,
    height: normalised.info.height,
    // A real alt text belongs to whoever writes the listing; this is a floor,
    // not a ceiling. An empty alt on a product photo would be worse.
    alt: index === 0 ? title : `${title}, view ${index + 1}`,
  };
}

/** "grey-nike-hoodie" -> "Grey nike hoodie". A starting point, meant to be edited. */
function titleFrom(folderName: string): string {
  const words = folderName.replace(/[-_]+/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function subdirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readManifest(): Promise<Map<string, ManifestItem>> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const items = JSON.parse(raw) as ManifestItem[];

    return new Map(items.map((item) => [item.slug, item]));
  } catch {
    // No manifest yet, which is the normal case the first time.
    return new Map();
  }
}

function requireBlobToken(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Create a Blob store in the Vercel " +
        "dashboard (Storage -> Create -> Blob), then run `vercel env pull` or copy the " +
        "token into .env.",
    );
  }
}

await main();
