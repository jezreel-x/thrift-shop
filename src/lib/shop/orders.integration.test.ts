import { beforeEach, describe, expect, it } from "vitest";

import { Category, Condition, Gender, OrderStatus, ProductStatus } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { addToCart, resolveCart } from "./cart";
import { beginCheckout, claimPayment, getOrder, listOrdersBeingChecked } from "./orders";
import { releaseExpiredReservations, reserveProduct } from "./reservations";

cleanDatabaseBetweenTests();

let sequence = 0;

beforeEach(() => {
  sequence = 0;
});

const BUYER = { name: "Grace Wanjiku", phone: "254712345678" };

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

/** A buyer with a cart holding the given products. */
async function shopperWith(products: { id: string }[], email = "grace@example.com") {
  const user = await makeUser(email);
  const cart = await resolveCart({ userId: user.id });
  for (const product of products) await addToCart(cart.id, product.id);

  return { user, cartId: cart.id };
}

describe("beginCheckout", () => {
  it("reserves every item and records what was agreed", async () => {
    const products = [
      await makeProduct({ priceCents: 230_000 }),
      await makeProduct({ priceCents: 165_000 }),
    ];
    const { user, cartId } = await shopperWith(products);

    const result = await beginCheckout(user.id, cartId, BUYER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true },
    });
    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(order.totalCents).toBe(395_000);
    expect(order.items).toHaveLength(2);

    for (const product of products) {
      const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(stored.status).toBe(ProductStatus.RESERVED);
      expect(stored.reservedBy).toBe(user.id);
    }
  });

  it("gives a reference drawn from unambiguous characters", async () => {
    // It gets read aloud over WhatsApp and typed back by somebody not looking.
    const { user, cartId } = await shopperWith([await makeProduct()]);

    const result = await beginCheckout(user.id, cartId, BUYER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toMatch(/^TP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it("proceeds with what it can and names what dropped out", async () => {
    const available = await makeProduct({ title: "Grey hoodie" });
    const gone = await makeProduct({ title: "Blue hoodie", status: ProductStatus.SOLD });
    const { user, cartId } = await shopperWith([available, gone]);

    const result = await beginCheckout(user.id, cartId, BUYER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.droppedTitles).toEqual(["Blue hoodie"]);

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true },
    });
    expect(order.items.map((item) => item.title)).toEqual(["Grey hoodie"]);
    expect(order.totalCents).toBe(100_000);
  });

  it("refuses an empty cart", async () => {
    const { user, cartId } = await shopperWith([]);

    expect(await beginCheckout(user.id, cartId, BUYER)).toEqual({
      ok: false,
      reason: "empty-cart",
    });
  });

  it("refuses when nothing in the cart can be held", async () => {
    const taken = await makeProduct();
    await reserveProduct(taken.id, "another-shopper");
    const { user, cartId } = await shopperWith([taken]);

    expect(await beginCheckout(user.id, cartId, BUYER)).toEqual({
      ok: false,
      reason: "nothing-available",
    });
  });

  it("re-entering checkout reuses the same order rather than opening a second", async () => {
    const { user, cartId } = await shopperWith([await makeProduct()]);

    const first = await beginCheckout(user.id, cartId, BUYER);
    const second = await beginCheckout(user.id, cartId, BUYER);

    expect(first.ok && second.ok && first.reference === second.reference).toBe(true);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rebuilds the lines when availability changed between visits", async () => {
    const keeping = await makeProduct({ title: "Kept" });
    const losing = await makeProduct({ title: "Lost" });
    const { user, cartId } = await shopperWith([keeping, losing]);
    await beginCheckout(user.id, cartId, BUYER);

    // Somebody else takes one, after the first visit to checkout.
    await db.product.update({
      where: { id: losing.id },
      data: { status: ProductStatus.SOLD, reservedBy: null, reservedUntil: null },
    });

    const second = await beginCheckout(user.id, cartId, BUYER);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const order = await db.order.findUniqueOrThrow({
      where: { id: second.orderId },
      include: { items: true },
    });
    expect(order.items.map((i) => i.title)).toEqual(["Kept"]);
    expect(order.totalCents).toBe(100_000);
  });

  it("snapshots the price, so repricing cannot rewrite what was agreed", async () => {
    const product = await makeProduct({ priceCents: 230_000 });
    const { user, cartId } = await shopperWith([product]);
    const result = await beginCheckout(user.id, cartId, BUYER);

    await db.product.update({ where: { id: product.id }, data: { priceCents: 999_000 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true },
    });
    expect(order.items[0].priceCents).toBe(230_000);
    expect(order.totalCents).toBe(230_000);
  });

  it("loses the race to a buyer who reserved first", async () => {
    const product = await makeProduct();
    const [grace, brian] = [
      await shopperWith([product], "grace@example.com"),
      await shopperWith([product], "brian@example.com"),
    ];

    const first = await beginCheckout(grace.user.id, grace.cartId, BUYER);
    const second = await beginCheckout(brian.user.id, brian.cartId, BUYER);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "nothing-available" });
  });
});

describe("claimPayment", () => {
  async function orderReadyToPay(email = "grace@example.com") {
    const { user, cartId } = await shopperWith([await makeProduct()], email);
    const result = await beginCheckout(user.id, cartId, BUYER);
    if (!result.ok) throw new Error("checkout failed to set up the test");

    return { user, orderId: result.orderId, reference: result.reference };
  }

  it("records the code and moves the order to pending confirmation", async () => {
    const { user, orderId } = await orderReadyToPay();

    expect(await claimPayment(orderId, user.id, "sgh7xkl2m9")).toMatchObject({ ok: true });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    // Upper-cased, because that is how Safaricom writes it in the SMS the owner
    // will be comparing against.
    expect(order.mpesaCode).toBe("SGH7XKL2M9");
    expect(order.claimedAt).toBeInstanceOf(Date);
  });

  it("extends the holds far past the sweep, so a paid item is not resold", async () => {
    // The failure this prevents: paid at 14:09, hold lapses at 14:15, the sweep
    // releases at 14:16, somebody else buys it, and the owner finds out at
    // bedtime that two people paid for one jacket.
    const { user, orderId } = await orderReadyToPay();

    await claimPayment(orderId, user.id, "SGH7XKL2M9");

    expect(await releaseExpiredReservations()).toBe(0);
  });

  it("refuses a code that another order already used", async () => {
    // The only check available in v1 that actually bites: the app cannot ask
    // Safaricom whether a code is real, but it can refuse to spend one twice.
    const grace = await orderReadyToPay("grace@example.com");
    const brian = await orderReadyToPay("brian@example.com");

    expect(await claimPayment(grace.orderId, grace.user.id, "SGH7XKL2M9")).toMatchObject({
      ok: true,
    });
    expect(await claimPayment(brian.orderId, brian.user.id, "SGH7XKL2M9")).toEqual({
      ok: false,
      reason: "code-already-used",
    });

    const brianOrder = await db.order.findUniqueOrThrow({ where: { id: brian.orderId } });
    expect(brianOrder.status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it("refuses to claim twice", async () => {
    const { user, orderId } = await orderReadyToPay();
    await claimPayment(orderId, user.id, "SGH7XKL2M9");

    expect(await claimPayment(orderId, user.id, "OTHERCODE1")).toEqual({
      ok: false,
      reason: "already-claimed",
    });
  });

  it("refuses somebody else's order", async () => {
    const { orderId } = await orderReadyToPay("grace@example.com");
    const stranger = await makeUser("brian@example.com");

    expect(await claimPayment(orderId, stranger.id, "SGH7XKL2M9")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses when a hold has already lapsed", async () => {
    const { user, orderId } = await orderReadyToPay();
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    await db.product.update({
      where: { id: order.items[0].productId },
      data: { reservedUntil: new Date(Date.now() - 1000) },
    });

    expect(await claimPayment(orderId, user.id, "SGH7XKL2M9")).toEqual({
      ok: false,
      reason: "hold-lapsed",
    });
  });
});

describe("getOrder", () => {
  it("finds an order by reference for its buyer", async () => {
    const { user, cartId } = await shopperWith([await makeProduct()]);
    const result = await beginCheckout(user.id, cartId, BUYER);
    if (!result.ok) throw new Error("setup");

    const found = await getOrder(result.reference, user.id);

    expect(found?.id).toBe(result.orderId);
  });

  it("will not show one buyer's order to another", async () => {
    // References are short by design, so they must not be the only thing
    // standing between a stranger and somebody's order.
    const { user, cartId } = await shopperWith([await makeProduct()]);
    const result = await beginCheckout(user.id, cartId, BUYER);
    if (!result.ok) throw new Error("setup");
    const stranger = await makeUser("brian@example.com");

    expect(await getOrder(result.reference, stranger.id)).toBeNull();
  });
});

describe("listOrdersBeingChecked", () => {
  it("lists only this buyer's orders whose payment is waiting to be checked", async () => {
    const grace = await shopperWith([await makeProduct()]);
    const unpaid = await shopperWith([await makeProduct()], "unpaid@example.com");
    const other = await shopperWith([await makeProduct()], "other@example.com");

    const graceOrder = await beginCheckout(grace.user.id, grace.cartId, BUYER);
    const unpaidOrder = await beginCheckout(unpaid.user.id, unpaid.cartId, BUYER);
    const otherOrder = await beginCheckout(other.user.id, other.cartId, BUYER);
    if (!graceOrder.ok || !unpaidOrder.ok || !otherOrder.ok) throw new Error("setup");

    // The claim hands back the reference, so the buyer can be sent straight to it.
    expect(await claimPayment(graceOrder.orderId, grace.user.id, "SGH7XKL2M9")).toEqual({
      ok: true,
      reference: graceOrder.reference,
    });
    await claimPayment(otherOrder.orderId, other.user.id, "SGH7XKL2M8");

    expect(await listOrdersBeingChecked(grace.user.id)).toEqual([
      { reference: graceOrder.reference },
    ]);
    // Not yet paid: nothing for the shop to check, so no reminder.
    expect(await listOrdersBeingChecked(unpaid.user.id)).toEqual([]);
  });
});
