import { describe, expect, it } from "vitest";

import { Category, Condition, Gender, OrderStatus, ProductStatus } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { addToCart, resolveCart } from "@/lib/shop/cart";
import { beginCheckout, claimPayment } from "@/lib/shop/orders";
import { releaseExpiredReservations, reserveProduct } from "@/lib/shop/reservations";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  confirmOrder,
  countOrdersByStatus,
  getOrderForReview,
  listOrdersForReview,
  rejectOrder,
} from "./orders";

cleanDatabaseBetweenTests();

let sequence = 0;

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

async function makeUser(email: string, name: string | null = null) {
  return db.user.create({
    data: { email, name, passwordHash: await hashPassword("a good passphrase") },
  });
}

let codes = 0;

/** An order whose buyer has checked out and says they have paid. */
async function claimedOrder(
  products: { id: string }[],
  buyer = { email: "grace@example.com", name: "Grace Wanjiku", phone: "254712345678" },
) {
  const user = await makeUser(buyer.email);
  const cart = await resolveCart({ userId: user.id });
  for (const product of products) await addToCart(cart.id, product.id);

  const result = await beginCheckout(user.id, cart.id, { name: buyer.name, phone: buyer.phone });
  if (!result.ok) throw new Error("checkout failed to set up the test");

  codes += 1;
  const claim = await claimPayment(
    result.orderId,
    user.id,
    `SGH7XKL${String(codes).padStart(3, "0")}`,
  );
  if (!claim.ok) throw new Error("claim failed to set up the test");

  return { user, orderId: result.orderId, reference: result.reference };
}

async function staff() {
  return makeUser(`staff-${sequence++}@example.com`, "Wanjiru");
}

const statusOf = async (productId: string) =>
  (await db.product.findUniqueOrThrow({ where: { id: productId } })).status;

describe("confirmOrder", () => {
  it("sells every item, records the note, and says who confirmed it", async () => {
    const products = [await makeProduct(), await makeProduct()];
    const { orderId, reference } = await claimedOrder(products);
    const reviewer = await staff();

    const result = await confirmOrder({ orderId, actorId: reviewer.id, note: " matched SMS " });

    expect(result).toEqual({ ok: true, reference });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(order.reviewNote).toBe("matched SMS");
    for (const product of products) expect(await statusOf(product.id)).toBe(ProductStatus.SOLD);

    const [entry] = await db.auditLog.findMany({ where: { entityId: orderId } });
    expect(entry).toMatchObject({
      actorId: reviewer.id,
      action: "order.confirm-payment",
      entityType: "Order",
      after: { status: OrderStatus.CONFIRMED, note: "matched SMS" },
    });
  });

  it("sells nothing if any hold has lapsed, and leaves the order pending", async () => {
    // The lapsed item may be in another buyer's checkout by now. Selling the
    // rest and stopping would leave an order half-confirmed.
    const [kept, lapsed] = [await makeProduct(), await makeProduct({ title: "Denim jacket" })];
    const { orderId } = await claimedOrder([kept, lapsed]);
    await db.product.update({
      where: { id: lapsed.id },
      data: { reservedUntil: new Date(Date.now() - 1000) },
    });

    const result = await confirmOrder({ orderId, actorId: (await staff()).id });

    expect(result).toEqual({ ok: false, reason: "hold-lapsed", titles: ["Denim jacket"] });
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.PENDING_CONFIRMATION,
    );
    expect(await statusOf(kept.id)).toBe(ProductStatus.RESERVED);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("will not confirm an order nobody has claimed payment for", async () => {
    const user = await makeUser("grace@example.com");
    const cart = await resolveCart({ userId: user.id });
    await addToCart(cart.id, (await makeProduct()).id);
    const checkout = await beginCheckout(user.id, cart.id, { name: "G", phone: "254712345678" });
    if (!checkout.ok) throw new Error("setup");

    expect(await confirmOrder({ orderId: checkout.orderId, actorId: (await staff()).id })).toEqual({
      ok: false,
      reason: "already-decided",
    });
  });

  it("will not confirm twice", async () => {
    const { orderId } = await claimedOrder([await makeProduct()]);
    const reviewer = await staff();

    expect((await confirmOrder({ orderId, actorId: reviewer.id })).ok).toBe(true);
    expect(await confirmOrder({ orderId, actorId: reviewer.id })).toEqual({
      ok: false,
      reason: "already-decided",
    });
    expect(await db.auditLog.count()).toBe(1);
  });

  it("keeps a confirmed order's items after the products are withdrawn", async () => {
    // Withdrawing is a soft delete precisely so an order does not lose what it
    // sold. A hard delete is refused by the foreign key.
    const products = [await makeProduct(), await makeProduct()];
    const { orderId } = await claimedOrder(products);
    await confirmOrder({ orderId, actorId: (await staff()).id });

    await db.product.update({ where: { id: products[0].id }, data: { deletedAt: new Date() } });

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    expect(order.items).toHaveLength(2);
    await expect(db.product.delete({ where: { id: products[0].id } })).rejects.toThrow();
  });

  it("says when there is no such order", async () => {
    expect(await confirmOrder({ orderId: "missing", actorId: (await staff()).id })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("rejectOrder", () => {
  it("returns every item to the rail, with the reason the buyer will see", async () => {
    const products = [await makeProduct(), await makeProduct()];
    const { orderId } = await claimedOrder(products);
    const reviewer = await staff();

    expect(
      (await rejectOrder({ orderId, actorId: reviewer.id, reason: "code not found" })).ok,
    ).toBe(true);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.REJECTED);
    expect(order.reviewNote).toBe("code not found");
    for (const product of products)
      expect(await statusOf(product.id)).toBe(ProductStatus.AVAILABLE);

    const history = await db.productStatusHistory.findFirst({
      where: { productId: products[0].id, toStatus: ProductStatus.AVAILABLE },
    });
    expect(history?.reason).toBe("payment rejected: code not found");

    const [entry] = await db.auditLog.findMany({ where: { entityId: orderId } });
    expect(entry).toMatchObject({
      actorId: reviewer.id,
      action: "order.reject-payment",
      after: { status: OrderStatus.REJECTED, reason: "code not found", itemsReturned: 2 },
    });
  });

  it("never touches an item another buyer has since reserved", async () => {
    // The first buyer's hold lapses, the sweep frees the jacket, and a second
    // buyer reserves it. Rejecting the first order must leave theirs alone.
    const jacket = await makeProduct();
    const { orderId } = await claimedOrder([jacket]);
    await db.product.update({
      where: { id: jacket.id },
      data: { reservedUntil: new Date(Date.now() - 1000) },
    });
    await releaseExpiredReservations();
    expect((await reserveProduct(jacket.id, "second-buyer")).ok).toBe(true);

    await rejectOrder({ orderId, actorId: (await staff()).id, reason: "code not found" });

    const stored = await db.product.findUniqueOrThrow({ where: { id: jacket.id } });
    expect(stored.status).toBe(ProductStatus.RESERVED);
    expect(stored.reservedBy).toBe("second-buyer");
  });
});

describe("two reviewers deciding at once", () => {
  it("lets exactly one decision through", async () => {
    const products = [await makeProduct(), await makeProduct()];
    const { orderId } = await claimedOrder(products);
    const [owner, cashier] = [await staff(), await staff()];

    const results = await Promise.all([
      confirmOrder({ orderId, actorId: owner.id }),
      rejectOrder({ orderId, actorId: cashier.id, reason: "code not found" }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "already-decided" },
    ]);
    expect(await db.auditLog.count()).toBe(1);

    // Whichever won, the items agree with it.
    const { status } = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const expected =
      status === OrderStatus.CONFIRMED ? ProductStatus.SOLD : ProductStatus.AVAILABLE;
    for (const product of products) expect(await statusOf(product.id)).toBe(expected);
  });
});

describe("the queue", () => {
  it("lists orders waiting for a decision oldest claim first", async () => {
    const first = await claimedOrder([await makeProduct()], {
      email: "a@example.com",
      name: "Achieng",
      phone: "254711111111",
    });
    const second = await claimedOrder([await makeProduct()], {
      email: "b@example.com",
      name: "Baraka",
      phone: "254722222222",
    });
    await db.order.update({
      where: { id: first.orderId },
      data: { claimedAt: new Date(Date.now() - 60_000) },
    });

    const { orders, total } = await listOrdersForReview({
      status: OrderStatus.PENDING_CONFIRMATION,
      page: 1,
    });

    expect(total).toBe(2);
    expect(orders.map((order) => order.reference)).toEqual([first.reference, second.reference]);
  });

  it("finds an order by reference, M-Pesa code, name or phone however it is typed", async () => {
    const wanted = await claimedOrder([await makeProduct()], {
      email: "a@example.com",
      name: "Achieng Otieno",
      phone: "254711111111",
    });
    await claimedOrder([await makeProduct()], {
      email: "b@example.com",
      name: "Baraka",
      phone: "254722222222",
    });
    const { mpesaCode } = await db.order.findUniqueOrThrow({ where: { id: wanted.orderId } });
    const search = async (term: string) =>
      (
        await listOrdersForReview({
          status: OrderStatus.PENDING_CONFIRMATION,
          search: term,
          page: 1,
        })
      ).orders.map((order) => order.reference);

    for (const term of [
      wanted.reference.toLowerCase(),
      mpesaCode!.toLowerCase(),
      "achieng",
      "0711 111 111",
      "+254711111111",
      "1111",
    ]) {
      expect(await search(term), term).toEqual([wanted.reference]);
    }
  });

  it("counts every state, including the empty ones", async () => {
    const { orderId } = await claimedOrder([await makeProduct()]);
    await confirmOrder({ orderId, actorId: (await staff()).id });
    await claimedOrder([await makeProduct()], {
      email: "b@example.com",
      name: "Baraka",
      phone: "254722222222",
    });

    expect(await countOrdersByStatus()).toEqual({
      [OrderStatus.AWAITING_PAYMENT]: 0,
      [OrderStatus.PENDING_CONFIRMATION]: 1,
      [OrderStatus.CONFIRMED]: 1,
      [OrderStatus.REJECTED]: 0,
      [OrderStatus.CANCELLED]: 0,
    });
  });

  it("shows a reviewer the order's history with names", async () => {
    const { orderId, reference } = await claimedOrder([await makeProduct()]);
    await confirmOrder({ orderId, actorId: (await staff()).id });

    const order = await getOrderForReview(reference.toLowerCase());

    expect(order?.history).toHaveLength(1);
    expect(order?.history[0]).toMatchObject({
      action: "order.confirm-payment",
      actor: { name: "Wanjiru" },
    });
  });
});
