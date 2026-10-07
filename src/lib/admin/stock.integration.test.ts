import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { reserveVariant } from "@/lib/shop/reservations";
import { makeProduct, stockOf } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  getStockView,
  holdForWhatsApp,
  markSoldElsewhere,
  releaseWhatsAppHold,
  sellWhatsAppHold,
} from "./stock";

cleanDatabaseBetweenTests();

async function staff() {
  return db.user.create({
    data: {
      email: "wanjiru@example.com",
      name: "Wanjiru",
      passwordHash: await hashPassword("a good passphrase"),
    },
  });
}

const HOUR = 3_600_000;

describe("markSoldElsewhere", () => {
  it("takes the units off the website, in the ledger and the audit log", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 3 });

    const result = await markSoldElsewhere({
      variantId: product.variantId,
      quantity: 2,
      actorId: owner.id,
    });

    expect(result).toEqual({ ok: true, productId: product.id });
    expect(await stockOf(product.variantId)).toBe(1);
    expect(await db.stockMovement.findFirst()).toMatchObject({
      change: -2,
      reason: "sold elsewhere",
      actorId: owner.id,
    });
    expect(await db.auditLog.findFirst()).toMatchObject({ action: "stock.sold-elsewhere" });
  });

  it("will not sell a unit that is in a buyer's checkout", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 1 });
    await reserveVariant(product.variantId, "buyer-1");

    const result = await markSoldElsewhere({
      variantId: product.variantId,
      quantity: 1,
      actorId: owner.id,
    });

    expect(result).toEqual({ ok: false, reason: "not-enough", free: 0, productId: product.id });
    expect(await stockOf(product.variantId)).toBe(1);
  });
});

describe("WhatsApp holds", () => {
  it("holds units so the website can't sell them, until sold", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 1 });

    const held = await holdForWhatsApp({
      variantId: product.variantId,
      quantity: 1,
      note: "Achieng, 0712 345 678",
      duration: "1d",
      actorId: owner.id,
    });
    expect(held.ok).toBe(true);

    // A buyer on the website now finds it taken.
    expect(await reserveVariant(product.variantId, "buyer-1")).toEqual({
      ok: false,
      reason: "held",
    });

    const view = await getStockView(product.id);
    expect(view?.rows[0]).toMatchObject({ stock: 1, onWhatsApp: 1, inCheckout: 0, free: 0 });
    expect(view?.holds).toMatchObject([
      { quantity: 1, note: "Achieng, 0712 345 678", lapsed: false, placedBy: "Wanjiru" },
    ]);

    const sold = await sellWhatsAppHold({ holdId: view!.holds[0].id, actorId: owner.id });
    expect(sold.ok).toBe(true);
    expect(await stockOf(product.variantId)).toBe(0);
    expect(await db.stockHold.count()).toBe(0);
    expect(await db.stockMovement.findFirst()).toMatchObject({
      change: -1,
      reason: "sold on WhatsApp",
      actorId: owner.id,
    });
  });

  it("refuses to hold more than is free, or without saying who it's for", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 2 });
    await reserveVariant(product.variantId, "buyer-1", 1);

    const hold = (quantity: number, note = "Achieng") =>
      holdForWhatsApp({
        variantId: product.variantId,
        quantity,
        note,
        duration: "2h",
        actorId: owner.id,
      });

    expect(await hold(2)).toMatchObject({ ok: false, reason: "not-enough", free: 1 });
    expect(await hold(1, "   ")).toEqual({ ok: false, reason: "bad-input" });
    expect((await hold(1)).ok).toBe(true);
  });

  it("won't sell a hold that ran out: its units may be someone else's now", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 1 });
    const placed = new Date(Date.now() - 3 * HOUR);
    await holdForWhatsApp({
      variantId: product.variantId,
      quantity: 1,
      note: "Achieng",
      duration: "2h",
      actorId: owner.id,
      now: placed,
    });
    const hold = await db.stockHold.findFirstOrThrow();

    expect(await sellWhatsAppHold({ holdId: hold.id, actorId: owner.id })).toEqual({
      ok: false,
      reason: "lapsed",
      productId: product.id,
    });
    expect(await stockOf(product.variantId)).toBe(1);
  });

  it("releases a WhatsApp hold, but never a buyer's own checkout", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 2 });
    await reserveVariant(product.variantId, "buyer-1");
    await holdForWhatsApp({
      variantId: product.variantId,
      quantity: 1,
      note: "Achieng",
      duration: "2h",
      actorId: owner.id,
    });
    const [checkout, whatsapp] = [
      await db.stockHold.findFirstOrThrow({ where: { holder: "buyer-1" } }),
      await db.stockHold.findFirstOrThrow({ where: { holder: { startsWith: "whatsapp:" } } }),
    ];

    expect(await releaseWhatsAppHold({ holdId: checkout.id, actorId: owner.id })).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(await sellWhatsAppHold({ holdId: checkout.id, actorId: owner.id })).toEqual({
      ok: false,
      reason: "gone",
    });
    expect((await releaseWhatsAppHold({ holdId: whatsapp.id, actorId: owner.id })).ok).toBe(true);
    expect(await db.stockHold.findMany({ select: { holder: true } })).toEqual([
      { holder: "buyer-1" },
    ]);
  });
});

describe("getStockView", () => {
  it("tells checkout holds from WhatsApp holds, and shows history with who and which order", async () => {
    const owner = await staff();
    const product = await makeProduct({}, { stock: 5 });
    await reserveVariant(product.variantId, "buyer-1", 2);
    await holdForWhatsApp({
      variantId: product.variantId,
      quantity: 1,
      note: "Achieng",
      duration: "2h",
      actorId: owner.id,
    });
    await markSoldElsewhere({ variantId: product.variantId, quantity: 1, actorId: owner.id });
    const order = await db.order.create({
      data: {
        reference: "TP-STOCK1",
        userId: owner.id,
        buyerName: "Achieng",
        buyerPhone: "254712345678",
        totalCents: 150_000,
      },
    });
    await db.stockMovement.create({
      data: {
        variantId: product.variantId,
        change: -1,
        reason: "sale confirmed",
        orderId: order.id,
      },
    });

    const view = await getStockView(product.id);

    expect(view?.rows[0]).toMatchObject({ stock: 4, inCheckout: 2, onWhatsApp: 1, free: 1 });
    expect(
      view?.history.map((event) => [event.change, event.reason, event.by, event.orderReference]),
    ).toEqual([
      [-1, "sale confirmed", null, "TP-STOCK1"],
      [-1, "sold elsewhere", "Wanjiru", null],
    ]);
  });
});
