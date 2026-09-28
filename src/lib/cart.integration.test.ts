import { beforeEach, describe, expect, it } from "vitest";

import { Category, Condition, Gender, ProductStatus } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  addToCart,
  clearCart,
  deleteAbandonedAnonymousCarts,
  getCartContents,
  mergeAnonymousCart,
  removeFromCart,
  resolveCart,
} from "./cart";
import { reserveProduct } from "./reservations";

cleanDatabaseBetweenTests();

let sequence = 0;

beforeEach(() => {
  sequence = 0;
});

async function makeProduct(overrides: Record<string, unknown> = {}) {
  sequence += 1;

  return db.product.create({
    data: {
      slug: `product-${sequence}`,
      title: `Product ${sequence}`,
      priceCents: 100_000,
      size: "M",
      category: Category.HOODIES,
      condition: Condition.GOOD,
      gender: Gender.UNISEX,
      ...overrides,
    },
  });
}

async function makeUser(email = "grace@example.com") {
  return db.user.create({
    data: { email, passwordHash: await hashPassword("a good passphrase") },
  });
}

describe("resolveCart", () => {
  it("creates a cart for an anonymous shopper and finds it again", async () => {
    const first = await resolveCart({});
    expect(first.isNew).toBe(true);

    const second = await resolveCart({ anonymousCartId: first.id });
    expect(second).toEqual({ id: first.id, isNew: false });
  });

  it("creates a fresh cart when the cookie names one that no longer exists", async () => {
    const { id, isNew } = await resolveCart({ anonymousCartId: "long-gone" });

    expect(isNew).toBe(true);
    expect(id).not.toBe("long-gone");
  });

  it("refuses to hand an account's cart to whoever holds the old cookie", async () => {
    // The cookie survives sign-in. Without the userId: null condition, it would
    // still resolve to a cart that now belongs to somebody's account.
    const user = await makeUser();
    const anonymous = await resolveCart({});
    await mergeAnonymousCart(anonymous.id, user.id);

    const resolved = await resolveCart({ anonymousCartId: anonymous.id });

    expect(resolved.id).not.toBe(anonymous.id);
    expect(resolved.isNew).toBe(true);
  });

  it("gives a signed-in shopper the same cart every time", async () => {
    const user = await makeUser();

    const first = await resolveCart({ userId: user.id });
    const second = await resolveCart({ userId: user.id });

    expect(second).toEqual({ id: first.id, isNew: false });
  });
});

describe("addToCart", () => {
  it("adds an item", async () => {
    const product = await makeProduct();
    const cart = await resolveCart({});

    await addToCart(cart.id, product.id);

    const { lines } = await getCartContents(cart.id);
    expect(lines.map((line) => line.productId)).toEqual([product.id]);
  });

  it("is idempotent — stock is one of one, so there is no second copy to add", async () => {
    const product = await makeProduct();
    const cart = await resolveCart({});

    await addToCart(cart.id, product.id);
    await addToCart(cart.id, product.id);

    expect((await getCartContents(cart.id)).lines).toHaveLength(1);
  });

  it("accepts an item somebody else is currently checking out with", async () => {
    // That hold may lapse. Refusing here would make the cart wrong for fifteen
    // minutes on the strength of a purchase that might never complete.
    const product = await makeProduct();
    await reserveProduct(product.id, "another-shopper");
    const cart = await resolveCart({});

    await addToCart(cart.id, product.id);

    expect((await getCartContents(cart.id)).lines).toHaveLength(1);
  });

  it("ignores a withdrawn product, which there is nothing to add", async () => {
    const product = await makeProduct({ deletedAt: new Date() });
    const cart = await resolveCart({});

    await addToCart(cart.id, product.id);

    expect((await getCartContents(cart.id)).lines).toHaveLength(0);
  });
});

describe("removeFromCart and clearCart", () => {
  it("removes one item and leaves the rest", async () => {
    const [a, b] = [await makeProduct(), await makeProduct()];
    const cart = await resolveCart({});
    await addToCart(cart.id, a.id);
    await addToCart(cart.id, b.id);

    await removeFromCart(cart.id, a.id);

    expect((await getCartContents(cart.id)).lines.map((l) => l.productId)).toEqual([b.id]);
  });

  it("empties the cart", async () => {
    const product = await makeProduct();
    const cart = await resolveCart({});
    await addToCart(cart.id, product.id);

    await clearCart(cart.id);

    expect((await getCartContents(cart.id)).lines).toHaveLength(0);
  });

  it("removing something that is not there is not an error", async () => {
    const cart = await resolveCart({});

    await expect(removeFromCart(cart.id, "not-in-here")).resolves.toBeUndefined();
  });
});

describe("getCartContents — availability", () => {
  it("marks a sold item unavailable and excludes it from the total", async () => {
    const available = await makeProduct({ priceCents: 200_000 });
    const sold = await makeProduct({ priceCents: 500_000, status: ProductStatus.SOLD });
    const cart = await resolveCart({});
    await addToCart(cart.id, available.id);
    await addToCart(cart.id, sold.id);

    const contents = await getCartContents(cart.id);

    expect(contents.lines.find((l) => l.productId === sold.id)).toMatchObject({
      available: false,
      reason: "sold",
    });
    expect(contents.totalCents).toBe(200_000);
    expect(contents.availableCount).toBe(1);
  });

  it("marks an item held by somebody else as held", async () => {
    const product = await makeProduct();
    const cart = await resolveCart({});
    await addToCart(cart.id, product.id);
    await reserveProduct(product.id, "another-shopper");

    const [line] = (await getCartContents(cart.id, "me")).lines;

    expect(line).toMatchObject({ available: false, reason: "held" });
  });

  it("treats the shopper's own reservation as available to them", async () => {
    // Otherwise returning to the cart mid-checkout reports your own hold as
    // somebody else's, and the item you are buying looks gone.
    const product = await makeProduct();
    const cart = await resolveCart({});
    await addToCart(cart.id, product.id);
    await reserveProduct(product.id, "me");

    const [line] = (await getCartContents(cart.id, "me")).lines;

    expect(line.available).toBe(true);
  });

  it("treats a lapsed hold as available, matching what checkout would grant", async () => {
    const product = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "someone",
      reservedUntil: new Date(Date.now() - 60_000),
    });
    const cart = await resolveCart({});
    await addToCart(cart.id, product.id);

    const [line] = (await getCartContents(cart.id, "me")).lines;

    expect(line.available).toBe(true);
  });

  it("marks a withdrawn item, rather than dropping it without explanation", async () => {
    const product = await makeProduct();
    const cart = await resolveCart({});
    await addToCart(cart.id, product.id);
    await db.product.update({ where: { id: product.id }, data: { deletedAt: new Date() } });

    const [line] = (await getCartContents(cart.id)).lines;

    expect(line).toMatchObject({ available: false, reason: "withdrawn" });
  });

  it("carries the thumbnail, and copes with a product that has none", async () => {
    const withPhoto = await makeProduct();
    const withoutPhoto = await makeProduct();
    await db.productImage.create({
      data: {
        productId: withPhoto.id,
        url: "https://example.test/1.webp",
        pathname: "1.webp",
        checksum: "sum",
        width: 800,
        height: 1200,
        position: 0,
      },
    });
    const cart = await resolveCart({});
    await addToCart(cart.id, withPhoto.id);
    await addToCart(cart.id, withoutPhoto.id);

    const { lines } = await getCartContents(cart.id);

    expect(lines.find((l) => l.productId === withPhoto.id)?.image?.url).toContain("1.webp");
    expect(lines.find((l) => l.productId === withoutPhoto.id)?.image).toBeNull();
  });

  it("an empty cart totals nothing rather than failing", async () => {
    const cart = await resolveCart({});

    expect(await getCartContents(cart.id)).toMatchObject({ lines: [], totalCents: 0 });
  });
});

describe("mergeAnonymousCart", () => {
  it("claims the cart outright when the account has none", async () => {
    const product = await makeProduct();
    const user = await makeUser();
    const anonymous = await resolveCart({});
    await addToCart(anonymous.id, product.id);

    await mergeAnonymousCart(anonymous.id, user.id);

    const theirs = await resolveCart({ userId: user.id });
    expect(theirs.id).toBe(anonymous.id);
    expect((await getCartContents(theirs.id)).lines).toHaveLength(1);
  });

  it("moves items into a cart they already had", async () => {
    const [saved, added] = [await makeProduct(), await makeProduct()];
    const user = await makeUser();
    const theirs = await resolveCart({ userId: user.id });
    await addToCart(theirs.id, saved.id);

    const anonymous = await resolveCart({});
    await addToCart(anonymous.id, added.id);

    await mergeAnonymousCart(anonymous.id, user.id);

    const { lines } = await getCartContents(theirs.id);
    expect(lines.map((l) => l.productId).sort()).toEqual([saved.id, added.id].sort());
    expect(await db.cart.findUnique({ where: { id: anonymous.id } })).toBeNull();
  });

  it("does not duplicate an item both carts held", async () => {
    const product = await makeProduct();
    const user = await makeUser();
    const theirs = await resolveCart({ userId: user.id });
    await addToCart(theirs.id, product.id);

    const anonymous = await resolveCart({});
    await addToCart(anonymous.id, product.id);

    await mergeAnonymousCart(anonymous.id, user.id);

    expect((await getCartContents(theirs.id)).lines).toHaveLength(1);
  });

  it("does nothing when there is no anonymous cart to merge", async () => {
    const user = await makeUser();

    await expect(mergeAnonymousCart(undefined, user.id)).resolves.toBeUndefined();
    await expect(mergeAnonymousCart("never-existed", user.id)).resolves.toBeUndefined();
  });

  it("will not steal a cart that already belongs to somebody", async () => {
    const [grace, brian] = [
      await makeUser("grace@example.com"),
      await makeUser("brian@example.com"),
    ];
    const graces = await resolveCart({ userId: grace.id });

    await mergeAnonymousCart(graces.id, brian.id);

    expect((await resolveCart({ userId: grace.id })).id).toBe(graces.id);
    expect((await resolveCart({ userId: brian.id })).id).not.toBe(graces.id);
  });
});

describe("deleteAbandonedAnonymousCarts", () => {
  it("clears old anonymous carts and keeps recent and signed-in ones", async () => {
    const user = await makeUser();
    const mine = await resolveCart({ userId: user.id });
    const fresh = await resolveCart({});
    const stale = await resolveCart({});

    await db.cart.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    // An account's cart is kept however long it sits.
    await db.cart.update({
      where: { id: mine.id },
      data: { updatedAt: new Date(Date.now() - 400 * 86_400_000) },
    });

    expect(await deleteAbandonedAnonymousCarts()).toBe(1);

    expect(await db.cart.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.cart.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.cart.findUnique({ where: { id: mine.id } })).not.toBeNull();
  });
});
