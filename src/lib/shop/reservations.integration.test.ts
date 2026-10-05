import { describe, expect, it } from "vitest";

import { makeProduct, stockOf } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  PAYMENT_REVIEW_HOURS,
  RESERVATION_MINUTES,
  confirmSale,
  getAvailability,
  holdForPaymentReview,
  releaseExpiredReservations,
  releaseHoldIn,
  releaseReservation,
  reserveVariant,
} from "./reservations";

cleanDatabaseBetweenTests();

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

const holdOf = (variantId: string, holder: string) =>
  db.stockHold.findUnique({ where: { variantId_holder: { variantId, holder } } });

/** Lets an existing hold lapse, as if its fifteen minutes had passed. */
const lapse = (variantId: string, holder: string) =>
  db.stockHold.update({
    where: { variantId_holder: { variantId, holder } },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

describe("two buyers, one jacket", () => {
  it("lets exactly one of two simultaneous buyers reserve it", async () => {
    const { variantId } = await makeProduct();

    const [first, second] = await Promise.all([
      reserveVariant(variantId, "buyer-a"),
      reserveVariant(variantId, "buyer-b"),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

    const loser = first.ok ? second : first;
    expect(loser).toEqual({ ok: false, reason: "held" });
  });

  it("lets exactly one of twenty simultaneous buyers reserve it", async () => {
    // Twenty genuinely parallel attempts across the connection pool: the case
    // a one-of-one shop exists to get right.
    const { variantId } = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveVariant(variantId, `buyer-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.stockHold.count()).toBe(1);
  });

  it("leaves stock alone: a hold is counted against it, never subtracted from it", async () => {
    const { variantId } = await makeProduct();

    await reserveVariant(variantId, "buyer");

    expect(await stockOf(variantId)).toBe(1);
  });
});

describe("twenty buyers, three units", () => {
  it("lets exactly three of twenty simultaneous buyers hold one each", async () => {
    const { variantId } = await makeProduct({}, { stock: 3 });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveVariant(variantId, `buyer-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    const { _sum } = await db.stockHold.aggregate({ _sum: { quantity: true } });
    expect(_sum.quantity).toBe(3);
  });

  it("never holds more than the stock, however large the requests interleave", async () => {
    const { variantId } = await makeProduct({}, { stock: 3 });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => reserveVariant(variantId, `buyer-${index}`, 2)),
    );

    const held = results.reduce((sum, result) => sum + (result.ok ? result.quantity : 0), 0);
    expect(held).toBe(3);
  });
});

describe("reserveVariant", () => {
  it("holds the units for the configured window", async () => {
    const { variantId } = await makeProduct({}, { stock: 4 });

    const result = await reserveVariant(variantId, "buyer", 2);

    expect(result.ok && result.quantity).toBe(2);
    const hold = await holdOf(variantId, "buyer");
    expect(hold?.quantity).toBe(2);
    const minutes = ((hold?.expiresAt.getTime() ?? 0) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(RESERVATION_MINUTES - 0.1);
    expect(minutes).toBeLessThanOrEqual(RESERVATION_MINUTES);
  });

  it("holds fewer when fewer are free, and says how many", async () => {
    const { variantId } = await makeProduct({}, { stock: 3 });
    await reserveVariant(variantId, "first", 2);

    const result = await reserveVariant(variantId, "second", 2);

    expect(result.ok && result.quantity).toBe(1);
  });

  it("refuses a sold-out variant, and says so", async () => {
    const { variantId } = await makeProduct({}, { stock: 0 });

    expect(await reserveVariant(variantId, "buyer")).toEqual({ ok: false, reason: "sold" });
  });

  it("refuses a withdrawn product", async () => {
    const { variantId } = await makeProduct({ deletedAt: new Date() });

    expect(await reserveVariant(variantId, "buyer")).toEqual({ ok: false, reason: "gone" });
  });

  it("refuses a variant that does not exist", async () => {
    expect(await reserveVariant("missing", "buyer")).toEqual({ ok: false, reason: "gone" });
  });

  it("treats a lapsed hold as free, without waiting for the sweep", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "first");
    await lapse(variantId, "first");

    expect((await reserveVariant(variantId, "second")).ok).toBe(true);
  });

  it("lets the same buyer extend their own hold, so a page refresh does not lose it", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");

    const again = await reserveVariant(variantId, "buyer");

    expect(again.ok).toBe(true);
    expect(await db.stockHold.count()).toBe(1);
  });

  it("asks for at least one, whatever it is passed", async () => {
    const { variantId } = await makeProduct({}, { stock: 2 });

    const result = await reserveVariant(variantId, "buyer", 0);

    expect(result.ok && result.quantity).toBe(1);
  });
});

describe("releaseReservation", () => {
  it("frees an abandoned hold for the next buyer", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer-a");

    expect(await releaseReservation(variantId, "buyer-a")).toBe(true);

    expect((await reserveVariant(variantId, "buyer-b")).ok).toBe(true);
  });

  it("refuses to release somebody else's hold", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "owner-of-hold");

    expect(await releaseReservation(variantId, "stranger")).toBe(false);
    expect(await holdOf(variantId, "owner-of-hold")).not.toBeNull();
  });
});

describe("confirmSale", () => {
  it("takes the held units out of stock, ends the hold, and records it in the ledger", async () => {
    const { variantId } = await makeProduct({}, { stock: 5 });
    await reserveVariant(variantId, "buyer", 2);

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 2, orderId: "order-1" })).toBe(
      true,
    );

    expect(await stockOf(variantId)).toBe(3);
    expect(await holdOf(variantId, "buyer")).toBeNull();
    const [movement] = await db.stockMovement.findMany({ where: { variantId } });
    expect(movement).toMatchObject({ change: -2, reason: "sale confirmed", orderId: "order-1" });
  });

  it("refuses to sell somebody else's hold", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");

    expect(await confirmSale({ variantId, holder: "stranger", quantity: 1 })).toBe(false);
    expect(await stockOf(variantId)).toBe(1);
  });

  it("refuses a hold that has already lapsed", async () => {
    // Once lapsed, the unit may already be in another buyer's checkout.
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");
    await lapse(variantId, "buyer");

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 1 })).toBe(false);
  });

  it("cannot be applied twice", async () => {
    const { variantId } = await makeProduct({}, { stock: 3 });
    await reserveVariant(variantId, "buyer");

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 1 })).toBe(true);
    expect(await confirmSale({ variantId, holder: "buyer", quantity: 1 })).toBe(false);
    expect(await stockOf(variantId)).toBe(2);
  });

  it("refuses to sell more than the hold covers", async () => {
    const { variantId } = await makeProduct({}, { stock: 5 });
    await reserveVariant(variantId, "buyer", 1);

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 2 })).toBe(false);
  });

  it("refuses when the owner has since lowered stock below what was held", async () => {
    const { variantId } = await makeProduct({}, { stock: 2 });
    await reserveVariant(variantId, "buyer", 2);
    await db.productVariant.update({ where: { id: variantId }, data: { stock: 1 } });

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 2 })).toBe(false);
    expect(await stockOf(variantId)).toBe(1);
  });
});

describe("holdForPaymentReview", () => {
  it("extends the hold to a day, so a paid unit is not resold overnight", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");

    expect(await holdForPaymentReview(variantId, "buyer")).toBe(true);

    const hold = await holdOf(variantId, "buyer");
    const hours = ((hold?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(PAYMENT_REVIEW_HOURS - 0.1);
  });

  it("refuses to extend a hold belonging to someone else", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");

    expect(await holdForPaymentReview(variantId, "stranger")).toBe(false);
  });

  it("refuses to extend a hold that has already lapsed", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");
    await lapse(variantId, "buyer");

    expect(await holdForPaymentReview(variantId, "buyer")).toBe(false);
  });

  it("still allows the sale to be completed afterwards", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");
    await holdForPaymentReview(variantId, "buyer");

    expect(await confirmSale({ variantId, holder: "buyer", quantity: 1 })).toBe(true);
  });
});

describe("releaseHoldIn", () => {
  const release = (variantId: string, holder: string) =>
    db.$transaction((tx) => releaseHoldIn(tx, variantId, holder));

  it("releases its holder's hold, even after it lapsed", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "buyer");
    await lapse(variantId, "buyer");

    expect(await release(variantId, "buyer")).toBe(true);
    expect(await holdOf(variantId, "buyer")).toBeNull();
  });

  it("will not release somebody else's hold", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "second-buyer");

    expect(await release(variantId, "first-buyer")).toBe(false);
    expect(await holdOf(variantId, "second-buyer")).not.toBeNull();
  });
});

describe("releaseExpiredReservations", () => {
  it("deletes lapsed holds and leaves live ones alone", async () => {
    const lapsed = await makeProduct();
    const live = await makeProduct();
    await reserveVariant(lapsed.variantId, "a");
    await reserveVariant(live.variantId, "b");
    await lapse(lapsed.variantId, "a");

    expect(await releaseExpiredReservations()).toBe(1);

    expect(await holdOf(lapsed.variantId, "a")).toBeNull();
    expect(await holdOf(live.variantId, "b")).not.toBeNull();
  });

  it("is housekeeping only: a lapsed hold was already free before it ran", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "a");
    await lapse(variantId, "a");

    const before = await getAvailability([variantId]);
    expect(before.get(variantId)).toEqual({ stock: 1, heldByOthers: 0 });
  });

  it("is safe to run repeatedly", async () => {
    const { variantId } = await makeProduct();
    await reserveVariant(variantId, "a");
    await lapse(variantId, "a");

    expect(await releaseExpiredReservations()).toBe(1);
    expect(await releaseExpiredReservations()).toBe(0);
  });
});

describe("getAvailability", () => {
  it("counts other shoppers' holds, but not the viewer's own", async () => {
    const { variantId } = await makeProduct({}, { stock: 3 });
    await reserveVariant(variantId, "viewer", 1);
    await reserveVariant(variantId, "someone-else", 1);

    expect((await getAvailability([variantId], "viewer")).get(variantId)).toEqual({
      stock: 3,
      heldByOthers: 1,
    });
    expect((await getAvailability([variantId])).get(variantId)).toEqual({
      stock: 3,
      heldByOthers: 2,
    });
  });
});

describe("the database itself", () => {
  it("refuses negative stock, whatever the code does", async () => {
    const { variantId } = await makeProduct();

    await expect(
      db.productVariant.update({ where: { id: variantId }, data: { stock: -1 } }),
    ).rejects.toThrow();
  });

  it("refuses a second variant for the same product and size", async () => {
    const product = await makeProduct();

    await expect(
      db.productVariant.create({ data: { productId: product.id, option2: "M", stock: 1 } }),
    ).rejects.toThrow();
  });
});

describe("why this is not a read-then-write", () => {
  /**
   * The lost update, written out so the difference is executable rather than
   * asserted. Two statements: count what is free, then hold. Every concurrent
   * caller counts before any of them holds, so every one of them believes it won.
   */
  async function naiveReserve(variantId: string, holder: string): Promise<boolean> {
    const variant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const { _sum } = await db.stockHold.aggregate({
      where: { variantId, expiresAt: { gt: new Date() } },
      _sum: { quantity: true },
    });
    if (variant.stock - (_sum.quantity ?? 0) < 1) return false;

    await db.stockHold.create({
      data: { variantId, holder, quantity: 1, expiresAt: minutesFromNow(15) },
    });

    return true;
  }

  it("the naive version holds one jacket for many buyers", async () => {
    const { variantId } = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => naiveReserve(variantId, `buyer-${index}`)),
    );

    expect(results.filter(Boolean).length).toBeGreaterThan(1);
  });

  it("locking the variant first holds it for one", async () => {
    const { variantId } = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveVariant(variantId, `buyer-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});

describe("the whole lifecycle", () => {
  it("reserves, sells, and leaves a ledger of what happened", async () => {
    const { variantId } = await makeProduct();

    await reserveVariant(variantId, "buyer");
    await confirmSale({ variantId, holder: "buyer", quantity: 1 });

    expect(await stockOf(variantId)).toBe(0);
    expect(await reserveVariant(variantId, "next")).toEqual({ ok: false, reason: "sold" });
    const ledger = await db.stockMovement.findMany({ where: { variantId } });
    expect(ledger.map((row) => [row.change, row.reason])).toEqual([[-1, "sale confirmed"]]);
  });

  it("frees an abandoned item and lets the next buyer take it", async () => {
    const { variantId } = await makeProduct();

    await reserveVariant(variantId, "buyer-a");
    await releaseReservation(variantId, "buyer-a");
    const second = await reserveVariant(variantId, "buyer-b");

    expect(second.ok).toBe(true);
    expect(await confirmSale({ variantId, holder: "buyer-b", quantity: 1 })).toBe(true);
  });
});
