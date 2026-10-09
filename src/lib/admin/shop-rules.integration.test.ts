import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { addToCart, getCartContents, resolveCart, setCartQuantity } from "@/lib/shop/cart";
import { getProductCards } from "@/lib/shop/products";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { listSettingsHistory } from "./payment-settings";
import { getShopRulesFormValue, saveShopRules } from "./shop-rules";

cleanDatabaseBetweenTests();

async function owner() {
  return db.user.create({
    data: {
      email: "wanjiru@example.com",
      name: "Wanjiru",
      passwordHash: await hashPassword("a good passphrase"),
    },
  });
}

async function cartWith(stock: number) {
  const product = await makeProduct({}, { stock });
  const cart = await resolveCart({});

  return { product, cartId: cart.id };
}

const lineQuantity = async (cartId: string) => (await getCartContents(cartId)).lines[0];

describe("the per-item limit", () => {
  it("is 5 until the owner sets it", async () => {
    const { product, cartId } = await cartWith(22);

    await addToCart(cartId, product.variantId, 9);

    expect(await getShopRulesFormValue()).toEqual({ maxPerItem: 5 });
    expect(await lineQuantity(cartId)).toMatchObject({ quantity: 5, maxQuantity: 5 });
  });

  it("follows the owner's limit in the cart, its steppers and the catalogue's quick add", async () => {
    const actor = await owner();
    await saveShopRules({ value: { maxPerItem: 12 }, actorId: actor.id });
    const { product, cartId } = await cartWith(22);

    await addToCart(cartId, product.variantId, 9);
    await addToCart(cartId, product.variantId, 9);
    expect(await lineQuantity(cartId)).toMatchObject({ quantity: 12, maxQuantity: 12 });

    await setCartQuantity(cartId, product.variantId, 30);
    expect((await lineQuantity(cartId)).quantity).toBe(12);

    const [card] = await getProductCards([product.id]);
    expect(card.quickAdd?.maxQuantity).toBe(12);
  });

  it("with no limit, offers everything that's free", async () => {
    const actor = await owner();
    await saveShopRules({ value: { maxPerItem: null }, actorId: actor.id });
    const { product, cartId } = await cartWith(22);

    await addToCart(cartId, product.variantId, 20);

    expect(await lineQuantity(cartId)).toMatchObject({ quantity: 20, maxQuantity: 22 });
  });

  it("is audited, says so in Recent changes, and notices when nothing changed", async () => {
    const actor = await owner();

    expect(await saveShopRules({ value: { maxPerItem: 20 }, actorId: actor.id })).toEqual({
      changed: true,
    });
    expect(await saveShopRules({ value: { maxPerItem: 20 }, actorId: actor.id })).toEqual({
      changed: false,
    });
    expect(await listSettingsHistory({ type: "rules" })).toMatchObject([
      { type: "rules", actor: "Wanjiru", changes: ["Most of one item per order: 5 → 20"] },
    ]);
  });
});
