import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  type InspectBlob,
  MAX_PHOTOS,
  attachPhoto,
  listPhotos,
  movePhoto,
  removePhoto,
  updatePhoto,
} from "./photos";

cleanDatabaseBetweenTests();

/** A pretend photo and the name the browser would give it. */
function photo(content: string) {
  const bytes = new TextEncoder().encode(content);
  const hash = createHash("sha256").update(bytes).digest("hex");

  return { bytes, pathname: `products/${hash}.webp` };
}

/** Storage holding these files, without the network. */
function storage(files: Record<string, Uint8Array>, contentType = "image/webp"): InspectBlob {
  return async (pathname) => {
    const bytes = files[pathname];
    if (!bytes) return null;

    return {
      url: `https://store.public.blob.vercel-storage.com/${pathname}`,
      contentType,
      bytes: bytes.slice().buffer,
    };
  };
}

async function staff() {
  return db.user.create({
    data: {
      email: "wanjiru@example.com",
      name: "Wanjiru",
      passwordHash: await hashPassword("a good passphrase"),
    },
  });
}

async function attach(
  productId: string,
  file: ReturnType<typeof photo>,
  actorId: string,
  extra: { swatchId?: string | null; inspect?: InspectBlob } = {},
) {
  return attachPhoto(
    {
      productId,
      swatchId: extra.swatchId ?? null,
      pathname: file.pathname,
      width: 1500,
      height: 2000,
      actorId,
    },
    extra.inspect ?? storage({ [file.pathname]: file.bytes }),
  );
}

describe("attachPhoto", () => {
  it("adds an uploaded photo at the end, described by the product's name until edited", async () => {
    const owner = await staff();
    const product = await makeProduct({ title: "Cargo Pants" });
    const front = photo("front");

    const result = await attach(product.id, front, owner.id);

    expect(result.ok).toBe(true);
    expect(await listPhotos(product.id)).toEqual([
      {
        id: expect.any(String),
        url: `https://store.public.blob.vercel-storage.com/${front.pathname}`,
        alt: "Cargo Pants",
        width: 1500,
        height: 2000,
        swatchId: null,
      },
    ]);
    expect(await db.auditLog.findFirst()).toMatchObject({
      action: "product.add-photo",
      actorId: owner.id,
    });
  });

  it("checks the stored file against its name instead of trusting the browser", async () => {
    const owner = await staff();
    const product = await makeProduct();
    const claimed = photo("what the browser said");

    const result = await attach(product.id, claimed, owner.id, {
      inspect: storage({ [claimed.pathname]: new TextEncoder().encode("something else") }),
    });

    expect(result).toEqual({ ok: false, reason: "content-mismatch" });
    expect(await db.productImage.count()).toBe(0);
  });

  it("refuses names it would not have handed out, files that never arrived, and non-images", async () => {
    const owner = await staff();
    const product = await makeProduct();
    const front = photo("front");

    expect(
      await attach(product.id, { ...front, pathname: "products/../secrets.webp" }, owner.id),
    ).toEqual({ ok: false, reason: "bad-name" });
    expect(await attach(product.id, front, owner.id, { inspect: storage({}) })).toEqual({
      ok: false,
      reason: "not-uploaded",
    });
    expect(
      await attach(product.id, front, owner.id, {
        inspect: storage({ [front.pathname]: front.bytes }, "text/html"),
      }),
    ).toEqual({ ok: false, reason: "not-uploaded" });
  });

  it("treats the same photo twice as one, but won't share it with another product", async () => {
    const owner = await staff();
    const [first, second] = [await makeProduct(), await makeProduct()];
    const front = photo("front");

    const once = await attach(first.id, front, owner.id);
    const twice = await attach(first.id, front, owner.id);
    expect(twice).toEqual(once);
    expect(await db.productImage.count()).toBe(1);

    expect(await attach(second.id, front, owner.id)).toEqual({
      ok: false,
      reason: "on-another-product",
    });
  });

  it("only tags a photo with this product's own colours", async () => {
    const owner = await staff();
    const [mine, theirs] = [await makeProduct(), await makeProduct()];
    const khaki = await db.productSwatch.create({ data: { productId: mine.id, name: "Khaki" } });
    const black = await db.productSwatch.create({ data: { productId: theirs.id, name: "Black" } });

    expect((await attach(mine.id, photo("a"), owner.id, { swatchId: khaki.id })).ok).toBe(true);
    expect(await attach(mine.id, photo("b"), owner.id, { swatchId: black.id })).toEqual({
      ok: false,
      reason: "no-swatch",
    });
  });

  it(`stops at ${MAX_PHOTOS} photos`, async () => {
    const owner = await staff();
    const product = await makeProduct();
    for (let n = 0; n < MAX_PHOTOS; n++) await attach(product.id, photo(`p${n}`), owner.id);

    expect(await attach(product.id, photo("one more"), owner.id)).toEqual({
      ok: false,
      reason: "too-many",
    });
  });
});

describe("ordering, tagging and removing", () => {
  async function threePhotos() {
    const owner = await staff();
    const product = await makeProduct();
    const ids: string[] = [];
    for (const name of ["front", "back", "label"]) {
      const result = await attach(product.id, photo(name), owner.id);
      if (result.ok) ids.push(result.id);
    }

    return { owner, product, ids };
  }

  const order = async (productId: string) => (await listPhotos(productId)).map((photo) => photo.id);

  it("moves a photo earlier, later, or to the front as the main photo", async () => {
    const { owner, product, ids } = await threePhotos();
    const [front, back, label] = ids;

    await movePhoto({ imageId: label, move: "first", actorId: owner.id });
    expect(await order(product.id)).toEqual([label, front, back]);

    await movePhoto({ imageId: label, move: "later", actorId: owner.id });
    expect(await order(product.id)).toEqual([front, label, back]);

    // Already first: nothing to do, nothing recorded.
    const before = await db.auditLog.count();
    await movePhoto({ imageId: front, move: "earlier", actorId: owner.id });
    expect(await db.auditLog.count()).toBe(before);

    const positions = await db.productImage.findMany({
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("closes the gap when a photo is removed", async () => {
    const { owner, product, ids } = await threePhotos();

    await removePhoto({ imageId: ids[0], actorId: owner.id });

    expect(await order(product.id)).toEqual([ids[1], ids[2]]);
    expect(
      (await db.productImage.findMany({ orderBy: { position: "asc" } })).map((row) => row.position),
    ).toEqual([0, 1]);
    expect(await db.auditLog.count({ where: { action: "product.remove-photo" } })).toBe(1);
  });

  it("tags a photo with a colour and describes it, and records what it was", async () => {
    const { owner, product, ids } = await threePhotos();
    const khaki = await db.productSwatch.create({ data: { productId: product.id, name: "Khaki" } });

    const result = await updatePhoto({
      imageId: ids[0],
      swatchId: khaki.id,
      alt: "  Khaki cargo pants,   front  ",
      actorId: owner.id,
    });

    expect(result.ok).toBe(true);
    expect(await db.productImage.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({
      swatchId: khaki.id,
      alt: "Khaki cargo pants, front",
    });
    expect(
      await db.auditLog.findFirst({ where: { action: "product.update-photo" } }),
    ).toMatchObject({ before: { swatchId: null }, after: { swatchId: khaki.id } });
  });
});
