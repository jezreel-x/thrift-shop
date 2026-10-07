import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { getDeliverySettings, saveDeliverySettings } from "@/lib/admin/delivery-settings";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { addToCart, resolveCart } from "./cart";
import { type DeliveryChoice, rememberedChoice } from "./delivery";
import { beginCheckout } from "./orders";
import { getDeliveryOptions } from "./settings";

cleanDatabaseBetweenTests();

const BUYER = { name: "Grace Wanjiku", phone: "254712345678" };

async function user(email = "grace@example.com") {
  return db.user.create({
    data: { email, name: "Grace", passwordHash: await hashPassword("a good passphrase") },
  });
}

async function setUp(actorId: string) {
  const saved = await saveDeliverySettings({
    value: {
      pickupAddress: "HH Towers, 4th floor",
      areas: [
        { id: null, name: "CBD", feeCents: 15_000 },
        { id: null, name: "Kilimani", feeCents: 25_000 },
      ],
    },
    actorId,
  });
  expect(saved).toEqual({ ok: true, changed: true });

  return getDeliveryOptions();
}

describe("delivery settings", () => {
  it("saves pickup and areas in order, audited, and notices when nothing changed", async () => {
    const owner = await user("owner@example.com");
    const options = await setUp(owner.id);

    expect(options).toMatchObject({
      pickupAddress: "HH Towers, 4th floor",
      areas: [
        { name: "CBD", feeCents: 15_000 },
        { name: "Kilimani", feeCents: 25_000 },
      ],
    });
    expect(await db.auditLog.findFirst()).toMatchObject({ action: "settings.update-delivery" });

    const same = await getDeliverySettings();
    expect(await saveDeliverySettings({ value: same, actorId: owner.id })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await db.auditLog.count()).toBe(1);
  });

  it("swaps two names, and removing an area forgets it on buyers' accounts", async () => {
    const owner = await user("owner@example.com");
    const options = await setUp(owner.id);
    const [cbd, kilimani] = options.areas;
    const buyer = await user();
    await db.user.update({
      where: { id: buyer.id },
      data: { fulfilment: "DELIVERY", deliveryAreaId: kilimani.id, deliveryAddress: "Blue Gate" },
    });

    const swapped = await saveDeliverySettings({
      value: {
        pickupAddress: null,
        areas: [
          { ...cbd, name: "Kilimani" },
          { ...kilimani, name: "CBD" },
        ],
      },
      actorId: owner.id,
    });
    expect(swapped.ok).toBe(true);

    await saveDeliverySettings({
      value: { pickupAddress: null, areas: [{ ...cbd, name: "Kilimani" }] },
      actorId: owner.id,
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).toMatchObject({
      deliveryAreaId: null,
      deliveryAddress: "Blue Gate",
    });
  });
});

describe("checkout with delivery", () => {
  async function buyerWithCart() {
    const buyer = await user();
    const cart = await resolveCart({ userId: buyer.id });
    const product = await makeProduct({ priceCents: 140_000 }, { stock: 2 });
    await addToCart(cart.id, product.variantId, 2);

    return { buyer, cartId: cart.id };
  }

  it("adds the area's fee to the total and copies where it goes onto the order", async () => {
    const owner = await user("owner@example.com");
    const options = await setUp(owner.id);
    const { buyer, cartId } = await buyerWithCart();
    const choice: DeliveryChoice = {
      fulfilment: "DELIVERY",
      area: options.areas[1],
      address: "Kindaruma Rd, Blue Gate",
      phone: "254700000001",
    };

    const result = await beginCheckout(buyer.id, cartId, BUYER, choice);

    expect(result.ok).toBe(true);
    expect(await db.order.findFirstOrThrow()).toMatchObject({
      totalCents: 280_000 + 25_000,
      fulfilment: "DELIVERY",
      deliveryArea: "Kilimani",
      deliveryAddress: "Kindaruma Rd, Blue Gate",
      deliveryPhone: "254700000001",
      deliveryFeeCents: 25_000,
      pickupAddress: null,
    });
  });

  it("switching to pickup on the same order drops the fee and the old address", async () => {
    const owner = await user("owner@example.com");
    const options = await setUp(owner.id);
    const { buyer, cartId } = await buyerWithCart();

    await beginCheckout(buyer.id, cartId, BUYER, {
      fulfilment: "DELIVERY",
      area: options.areas[0],
      address: "Moi Avenue",
      phone: "254700000001",
    });
    await beginCheckout(buyer.id, cartId, BUYER, {
      fulfilment: "PICKUP",
      pickupAddress: options.pickupAddress!,
    });

    expect(await db.order.count()).toBe(1);
    expect(await db.order.findFirstOrThrow()).toMatchObject({
      totalCents: 280_000,
      fulfilment: "PICKUP",
      pickupAddress: "HH Towers, 4th floor",
      deliveryArea: null,
      deliveryAddress: null,
      deliveryFeeCents: 0,
    });
  });

  it("charges today's fee when a remembered area has been repriced, and keeps old orders as agreed", async () => {
    const owner = await user("owner@example.com");
    const options = await setUp(owner.id);
    const { buyer, cartId } = await buyerWithCart();
    const kilimani = options.areas[1];
    await beginCheckout(buyer.id, cartId, BUYER, {
      fulfilment: "DELIVERY",
      area: kilimani,
      address: "Blue Gate",
      phone: "254700000001",
    });
    const first = await db.order.findFirstOrThrow();
    await db.order.update({ where: { id: first.id }, data: { status: "CANCELLED" } });

    await saveDeliverySettings({
      value: {
        pickupAddress: options.pickupAddress,
        areas: [options.areas[0], { ...kilimani, feeCents: 30_000 }],
      },
      actorId: owner.id,
    });
    const remembered = rememberedChoice(
      {
        fulfilment: "DELIVERY",
        deliveryAreaId: kilimani.id,
        deliveryAddress: "Blue Gate",
        deliveryPhone: "254700000001",
      },
      await getDeliveryOptions(),
    );
    await beginCheckout(buyer.id, cartId, BUYER, remembered);

    const orders = await db.order.findMany({ orderBy: { createdAt: "asc" } });
    expect(orders.map((order) => order.deliveryFeeCents)).toEqual([25_000, 30_000]);
  });
});
