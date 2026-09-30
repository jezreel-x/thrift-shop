import { beforeEach, describe, expect, it } from "vitest";

import { Category, Condition, Gender, ProductStatus } from "@/generated/prisma/enums";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  PAYMENT_REVIEW_HOURS,
  RESERVATION_MINUTES,
  confirmSale,
  forceRelease,
  holdForPaymentReview,
  releaseExpiredReservations,
  releaseReservation,
  reserveProduct,
} from "./reservations";

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
      priceCents: 150_000,
      size: "M",
      category: Category.HOODIES,
      condition: Condition.GOOD,
      gender: Gender.UNISEX,
      ...overrides,
    },
  });
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("two buyers, one jacket", () => {
  it("lets exactly one of two simultaneous buyers reserve it", async () => {
    const product = await makeProduct();

    const [first, second] = await Promise.all([
      reserveProduct(product.id, "buyer-a"),
      reserveProduct(product.id, "buyer-b"),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

    const loser = first.ok ? second : first;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.reason).toBe("held");
  });

  it("lets exactly one of twenty simultaneous buyers reserve it", async () => {
    // Twenty genuinely parallel attempts across the connection pool. This is the
    // test that would fail against a read-then-write: several would read
    // AVAILABLE before any of them wrote, and every one of them would believe it
    // had won.
    const product = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveProduct(product.id, `buyer-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(19);
  });

  it("records the winner as the holder, and nobody else", async () => {
    const product = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => reserveProduct(product.id, `buyer-${index}`)),
    );
    const winnerIndex = results.findIndex((result) => result.ok);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.status).toBe(ProductStatus.RESERVED);
    expect(stored.reservedBy).toBe(`buyer-${winnerIndex}`);
  });

  it("writes exactly one status-history row, however many buyers raced", async () => {
    // The losing attempts must leave no trace: a history full of failed claims
    // would make the audit trail useless for the disputes it exists to settle.
    const product = await makeProduct();

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => reserveProduct(product.id, `buyer-${index}`)),
    );

    const history = await db.productStatusHistory.findMany({ where: { productId: product.id } });
    expect(history).toHaveLength(1);
    expect(history[0].toStatus).toBe(ProductStatus.RESERVED);
    expect(history[0].fromStatus).toBe(ProductStatus.AVAILABLE);
  });
});

describe("reserveProduct", () => {
  it("holds the item for the configured window", async () => {
    const product = await makeProduct();
    const before = Date.now();

    const result = await reserveProduct(product.id, "buyer");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const heldFor = (result.reservedUntil.getTime() - before) / 60_000;
    expect(heldFor).toBeGreaterThan(RESERVATION_MINUTES - 1);
    expect(heldFor).toBeLessThanOrEqual(RESERVATION_MINUTES);
  });

  it("refuses a sold item, and says so", async () => {
    const product = await makeProduct({ status: ProductStatus.SOLD });

    const result = await reserveProduct(product.id, "buyer");

    expect(result).toEqual({ ok: false, reason: "sold" });
  });

  it("refuses a withdrawn item", async () => {
    const product = await makeProduct({ deletedAt: new Date() });

    const result = await reserveProduct(product.id, "buyer");

    expect(result).toEqual({ ok: false, reason: "gone" });
  });

  it("refuses an item that does not exist", async () => {
    const result = await reserveProduct("no-such-id", "buyer");

    expect(result).toEqual({ ok: false, reason: "gone" });
  });

  it("treats a lapsed hold as available, without waiting for the sweep", async () => {
    // The sweep keeps the catalogue honest; it is not what makes this correct.
    const product = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "buyer-a",
      reservedUntil: minutesFromNow(-1),
    });

    const result = await reserveProduct(product.id, "buyer-b");

    expect(result.ok).toBe(true);
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.reservedBy).toBe("buyer-b");
  });

  it("lets the same buyer extend their own hold, so a page refresh does not lose it", async () => {
    const product = await makeProduct();
    const first = await reserveProduct(product.id, "buyer");

    const second = await reserveProduct(product.id, "buyer", new Date(Date.now() + 60_000));

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reservedUntil.getTime()).toBeGreaterThan(first.reservedUntil.getTime());
  });

  it("does not log an extension as a transition", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");
    await reserveProduct(product.id, "buyer");
    await reserveProduct(product.id, "buyer");

    const history = await db.productStatusHistory.findMany({ where: { productId: product.id } });
    expect(history).toHaveLength(1);
  });
});

describe("releaseReservation", () => {
  it("returns an abandoned item to the catalogue", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");

    expect(await releaseReservation(product.id, "buyer")).toBe(true);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.status).toBe(ProductStatus.AVAILABLE);
    expect(stored.reservedBy).toBeNull();
    expect(stored.reservedUntil).toBeNull();
  });

  it("refuses to release somebody else's hold", async () => {
    // Otherwise anyone could knock an item out of a stranger's checkout.
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer-a");

    expect(await releaseReservation(product.id, "buyer-b")).toBe(false);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.reservedBy).toBe("buyer-a");
  });
});

describe("confirmSale", () => {
  it("completes a live reservation", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");

    expect(await confirmSale(product.id, "buyer")).toBe(true);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.status).toBe(ProductStatus.SOLD);
    expect(stored.reservedBy).toBeNull();
  });

  it("refuses to complete somebody else's reservation", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer-a");

    expect(await confirmSale(product.id, "buyer-b")).toBe(false);
  });

  it("refuses a hold that has already lapsed", async () => {
    // By now the item may belong to someone else. Honouring the stale hold is
    // exactly how two people end up paying for one jacket.
    const product = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "buyer",
      reservedUntil: minutesFromNow(-1),
    });

    expect(await confirmSale(product.id, "buyer")).toBe(false);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.status).toBe(ProductStatus.RESERVED);
  });

  it("cannot be applied twice", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");

    expect(await confirmSale(product.id, "buyer")).toBe(true);
    expect(await confirmSale(product.id, "buyer")).toBe(false);

    const history = await db.productStatusHistory.findMany({
      where: { productId: product.id, toStatus: ProductStatus.SOLD },
    });
    expect(history).toHaveLength(1);
  });
});

describe("releaseExpiredReservations", () => {
  it("returns lapsed holds and leaves live ones alone", async () => {
    const lapsed = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "buyer-a",
      reservedUntil: minutesFromNow(-1),
    });
    const live = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "buyer-b",
      reservedUntil: minutesFromNow(10),
    });

    expect(await releaseExpiredReservations()).toBe(1);

    expect((await db.product.findUniqueOrThrow({ where: { id: lapsed.id } })).status).toBe(
      ProductStatus.AVAILABLE,
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: live.id } })).status).toBe(
      ProductStatus.RESERVED,
    );
  });

  it("never touches sold items", async () => {
    // A sold item has no reservedUntil, but this is the sweep that runs forever
    // against the whole catalogue — it is worth pinning that it cannot resurrect
    // something already paid for.
    const sold = await makeProduct({ status: ProductStatus.SOLD });

    await releaseExpiredReservations();

    expect((await db.product.findUniqueOrThrow({ where: { id: sold.id } })).status).toBe(
      ProductStatus.SOLD,
    );
  });

  it("logs exactly the items it released", async () => {
    await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "a",
      reservedUntil: minutesFromNow(-1),
    });
    await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "b",
      reservedUntil: minutesFromNow(10),
    });

    await releaseExpiredReservations();

    const history = await db.productStatusHistory.findMany({
      where: { reason: "reservation expired" },
    });
    expect(history).toHaveLength(1);
  });

  it("does nothing, and reports nothing, when there is nothing to release", async () => {
    await makeProduct();

    expect(await releaseExpiredReservations()).toBe(0);
    expect(await db.productStatusHistory.count()).toBe(0);
  });

  it("is safe to run repeatedly", async () => {
    await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "a",
      reservedUntil: minutesFromNow(-1),
    });

    expect(await releaseExpiredReservations()).toBe(1);
    expect(await releaseExpiredReservations()).toBe(0);

    const history = await db.productStatusHistory.findMany({
      where: { reason: "reservation expired" },
    });
    expect(history).toHaveLength(1);
  });
});

describe("holdForPaymentReview", () => {
  it("extends the hold well past the sweep, so a paid item is not resold", async () => {
    // The failure this prevents: buyer pays at 14:09, hold lapses at 14:15, the
    // sweep releases at 14:16, somebody else buys it, and the owner discovers at
    // bedtime that two people paid for one jacket.
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");

    expect(await holdForPaymentReview(product.id, "buyer")).toBe(true);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    const heldForHours = (stored.reservedUntil!.getTime() - Date.now()) / 3_600_000;
    expect(heldForHours).toBeGreaterThan(PAYMENT_REVIEW_HOURS - 1);

    expect(await releaseExpiredReservations()).toBe(0);
  });

  it("refuses to extend a hold belonging to someone else", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer-a");

    expect(await holdForPaymentReview(product.id, "buyer-b")).toBe(false);
  });

  it("refuses to extend a hold that has already lapsed", async () => {
    const product = await makeProduct({
      status: ProductStatus.RESERVED,
      reservedBy: "buyer",
      reservedUntil: minutesFromNow(-1),
    });

    expect(await holdForPaymentReview(product.id, "buyer")).toBe(false);
  });

  it("does not record a status change, because there is not one", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");
    await holdForPaymentReview(product.id, "buyer");

    const history = await db.productStatusHistory.findMany({ where: { productId: product.id } });
    expect(history).toHaveLength(1);
  });

  it("still allows the sale to be completed afterwards", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");
    await holdForPaymentReview(product.id, "buyer");

    expect(await confirmSale(product.id, "buyer")).toBe(true);
  });
});

describe("forceRelease", () => {
  it("returns an item when the owner rejects the payment", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");
    await holdForPaymentReview(product.id, "buyer");

    expect(await forceRelease(product.id, "payment rejected")).toBe(true);

    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.status).toBe(ProductStatus.AVAILABLE);
    expect(stored.reservedBy).toBeNull();
  });

  it("records the reason, since overriding a buyer's hold needs explaining", async () => {
    const product = await makeProduct();
    await reserveProduct(product.id, "buyer");

    await forceRelease(product.id, "payment rejected: code already used");

    const history = await db.productStatusHistory.findFirst({
      where: { productId: product.id, toStatus: ProductStatus.AVAILABLE },
    });
    expect(history?.reason).toBe("payment rejected: code already used");
  });

  it("will not resurrect a sold item", async () => {
    const product = await makeProduct({ status: ProductStatus.SOLD });

    expect(await forceRelease(product.id, "mistake")).toBe(false);
  });
});

describe("why this is not a read-then-write", () => {
  /**
   * The lost update, written out so the difference is executable rather than
   * asserted. Two statements: check, then write. Every concurrent caller reads
   * before any of them writes, so every one of them believes it won.
   */
  async function naiveReserve(productId: string, holder: string): Promise<boolean> {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== ProductStatus.AVAILABLE) return false;

    await db.product.update({
      where: { id: productId },
      data: { status: ProductStatus.RESERVED, reservedBy: holder },
    });

    return true;
  }

  it("the naive version sells one jacket to twenty buyers", async () => {
    const product = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => naiveReserve(product.id, `buyer-${index}`)),
    );

    // Measured at 20 of 20, repeatably. This is not a rare race that needs
    // hammering to reproduce — under any real concurrency it is the norm.
    expect(results.filter(Boolean).length).toBeGreaterThan(1);
  });

  it("the conditional update sells it to one", async () => {
    const product = await makeProduct();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveProduct(product.id, `buyer-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});

describe("the whole lifecycle", () => {
  it("runs available, reserved, sold — and records each step", async () => {
    const product = await makeProduct();

    await reserveProduct(product.id, "buyer");
    await confirmSale(product.id, "buyer");

    const history = await db.productStatusHistory.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
    });

    expect(history.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      [ProductStatus.AVAILABLE, ProductStatus.RESERVED],
      [ProductStatus.RESERVED, ProductStatus.SOLD],
    ]);
  });

  it("returns an abandoned item and lets the next buyer take it", async () => {
    const product = await makeProduct();

    await reserveProduct(product.id, "buyer-a");
    await releaseReservation(product.id, "buyer-a");
    const second = await reserveProduct(product.id, "buyer-b");

    expect(second.ok).toBe(true);
    expect(await confirmSale(product.id, "buyer-b")).toBe(true);
  });
});
