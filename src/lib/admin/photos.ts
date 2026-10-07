import { createHash } from "node:crypto";

import { head } from "@vercel/blob";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { recordAudit } from "./audit";

/**
 * Product photos: adding, tagging, ordering and removing them.
 *
 * Uploads go from the browser straight to Vercel Blob, never through this
 * server: a photo is too big for a Server Action's request limit, and passing
 * it through a function would pay for the bandwidth twice. The browser shrinks
 * it first (2000px, WebP), hashes it, and names it by its hash:
 *
 *   products/<sha-256>.webp
 *
 * Then it asks this module to attach that name to a product. The file is
 * fetched back and hashed here, so a name always matches its content: the
 * browser's claim is checked, not trusted.
 *
 * Removing a photo removes it from the product, not from storage. The local
 * and live databases share one store, seeded from the same manifest, so a file
 * one of them no longer uses may be the other's main photo.
 */

export const PHOTO_PATHNAME = /^products\/[0-9a-f]{64}\.(webp|jpg)$/;
export const PHOTO_TYPES = ["image/webp", "image/jpeg"];
/** A 2000px WebP is well under 1MB; anything near this was not resized. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 12;
const MAX_ALT = 200;
const MAX_EDGE = 4000;

/** What storage says about a file, and its bytes. Injected in tests. */
export type InspectBlob = (
  pathname: string,
) => Promise<{ url: string; contentType: string; bytes: ArrayBuffer } | null>;

/** Looks the file up in Vercel Blob and downloads it. */
export const inspectBlob: InspectBlob = async (pathname) => {
  let blob;
  try {
    blob = await head(pathname);
  } catch {
    return null;
  }
  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) return null;

  return { url: blob.url, contentType: blob.contentType, bytes: await response.arrayBuffer() };
};

export type PhotoRefusal =
  | "bad-name"
  | "not-uploaded"
  | "content-mismatch"
  | "bad-size"
  | "no-product"
  | "no-swatch"
  | "too-many"
  | "on-another-product";

export const PHOTO_REFUSALS: Record<PhotoRefusal, string> = {
  "bad-name": "That upload wasn't named the way this page names photos. Reload and try again.",
  "not-uploaded": "The photo didn't finish uploading. Try again.",
  "content-mismatch": "The uploaded file doesn't match the photo. Try again.",
  "bad-size": "That photo's size couldn't be read. Try another.",
  "no-product": "This product no longer exists.",
  "no-swatch": "That colour no longer exists. Reload.",
  "too-many": `A product can have at most ${MAX_PHOTOS} photos.`,
  "on-another-product": "This exact photo is already on another product.",
};

export type AttachResult = { ok: true; id: string } | { ok: false; reason: PhotoRefusal };

export async function attachPhoto(
  input: {
    productId: string;
    swatchId: string | null;
    pathname: string;
    width: number;
    height: number;
    actorId: string;
  },
  inspect: InspectBlob = inspectBlob,
): Promise<AttachResult> {
  if (!PHOTO_PATHNAME.test(input.pathname)) return { ok: false, reason: "bad-name" };
  if (!validEdge(input.width) || !validEdge(input.height)) return { ok: false, reason: "bad-size" };

  const blob = await inspect(input.pathname);
  if (!blob || !PHOTO_TYPES.includes(blob.contentType)) {
    return { ok: false, reason: "not-uploaded" };
  }
  const checksum = createHash("sha256").update(Buffer.from(blob.bytes)).digest("hex");
  if (!input.pathname.startsWith(`products/${checksum}.`)) {
    return { ok: false, reason: "content-mismatch" };
  }

  return prisma.$transaction(async (tx): Promise<AttachResult> => {
    const product = await lockProduct(tx, input.productId);
    if (!product) return { ok: false, reason: "no-product" };
    if (input.swatchId && !(await swatchBelongs(tx, input.swatchId, input.productId))) {
      return { ok: false, reason: "no-swatch" };
    }

    // The same file twice is one photo: uploading again is harmless.
    const existing = await tx.productImage.findUnique({ where: { pathname: input.pathname } });
    if (existing) {
      return existing.productId === input.productId
        ? { ok: true, id: existing.id }
        : { ok: false, reason: "on-another-product" };
    }

    const count = await tx.productImage.count({ where: { productId: input.productId } });
    if (count >= MAX_PHOTOS) return { ok: false, reason: "too-many" };

    const image = await tx.productImage.create({
      data: {
        productId: input.productId,
        swatchId: input.swatchId,
        url: blob.url,
        pathname: input.pathname,
        checksum,
        width: input.width,
        height: input.height,
        // Better than nothing for a screen reader, until the owner writes one.
        alt: product.title,
        position: count,
      },
    });

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "product.add-photo",
      entityType: "Product",
      entityId: input.productId,
      after: { photo: image.id, pathname: image.pathname, swatchId: image.swatchId },
    });

    return { ok: true, id: image.id };
  });
}

/** Which colour a photo shows (null: every colour), and its description. */
export async function updatePhoto(input: {
  imageId: string;
  swatchId: string | null;
  alt: string;
  actorId: string;
}): Promise<{ ok: boolean; productId?: string }> {
  const alt = input.alt.trim().replace(/\s+/g, " ").slice(0, MAX_ALT);

  return prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: input.imageId } });
    if (!image) return { ok: false };
    if (input.swatchId && !(await swatchBelongs(tx, input.swatchId, image.productId))) {
      return { ok: false };
    }
    if (image.swatchId === input.swatchId && (image.alt ?? "") === alt) {
      return { ok: true, productId: image.productId };
    }

    await tx.productImage.update({
      where: { id: image.id },
      data: { swatchId: input.swatchId, alt: alt || null },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "product.update-photo",
      entityType: "Product",
      entityId: image.productId,
      before: { photo: image.id, swatchId: image.swatchId, alt: image.alt },
      after: { photo: image.id, swatchId: input.swatchId, alt: alt || null },
    });

    return { ok: true, productId: image.productId };
  });
}

export type PhotoMove = "earlier" | "later" | "first";

/**
 * Moves a photo in the product's order. Position 0 is the main photo: the
 * one on the catalogue card. Positions are rewritten 0, 1, 2… every time, so
 * gaps and ties left by older data cannot make the order ambiguous.
 */
export async function movePhoto(input: {
  imageId: string;
  move: PhotoMove;
  actorId: string;
}): Promise<{ ok: boolean; productId?: string }> {
  return prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: input.imageId } });
    if (!image) return { ok: false };
    await lockProduct(tx, image.productId);

    const order = (await orderedPhotos(tx, image.productId)).map((photo) => photo.id);
    const from = order.indexOf(image.id);
    const to =
      input.move === "first"
        ? 0
        : Math.min(Math.max(from + (input.move === "earlier" ? -1 : 1), 0), order.length - 1);
    if (from === to) return { ok: true, productId: image.productId };

    order.splice(from, 1);
    order.splice(to, 0, image.id);
    await renumber(tx, order);

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "product.reorder-photos",
      entityType: "Product",
      entityId: image.productId,
      after: { order },
    });

    return { ok: true, productId: image.productId };
  });
}

/** Takes a photo off the product. The file stays in storage: see the module comment. */
export async function removePhoto(input: {
  imageId: string;
  actorId: string;
}): Promise<{ ok: boolean; productId?: string }> {
  return prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: input.imageId } });
    if (!image) return { ok: false };
    await lockProduct(tx, image.productId);

    await tx.productImage.delete({ where: { id: image.id } });
    await renumber(
      tx,
      (await orderedPhotos(tx, image.productId)).map((photo) => photo.id),
    );

    await recordAudit(tx, {
      actorId: input.actorId,
      action: "product.remove-photo",
      entityType: "Product",
      entityId: image.productId,
      before: { photo: image.id, pathname: image.pathname, swatchId: image.swatchId },
    });

    return { ok: true, productId: image.productId };
  });
}

export type AdminPhoto = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  swatchId: string | null;
};

/** A product's photos in display order, the main one first. */
export async function listPhotos(productId: string): Promise<AdminPhoto[]> {
  const photos = await prisma.productImage.findMany({
    where: { productId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, url: true, alt: true, width: true, height: true, swatchId: true },
  });

  return photos.map((photo) => ({ ...photo, alt: photo.alt ?? "" }));
}

function orderedPhotos(tx: Prisma.TransactionClient, productId: string) {
  return tx.productImage.findMany({
    where: { productId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
}

async function renumber(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await tx.productImage.update({ where: { id }, data: { position } });
  }
}

/** Serialises photo changes to one product, so two reorders cannot interleave. */
async function lockProduct(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<{ id: string; title: string } | null> {
  const [row] = await tx.$queryRaw<{ id: string; title: string }[]>`
    SELECT "id", "title" FROM "Product" WHERE "id" = ${productId} FOR UPDATE
  `;

  return row ?? null;
}

async function swatchBelongs(
  tx: Prisma.TransactionClient,
  swatchId: string,
  productId: string,
): Promise<boolean> {
  return (await tx.productSwatch.count({ where: { id: swatchId, productId } })) > 0;
}

function validEdge(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_EDGE;
}
