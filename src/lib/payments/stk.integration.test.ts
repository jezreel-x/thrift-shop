import { describe, expect, it, vi } from "vitest";

import { OrderStatus, PaymentMethod, PaymentStatus, SettledVia } from "@/generated/prisma/enums";
import type { MpesaConfig } from "@/lib/mpesa/config";
import type { StkCallback, StkVerdict } from "@/lib/mpesa/daraja";
import { addToCart, resolveCart } from "@/lib/shop/cart";
import { beginCheckout, claimPayment } from "@/lib/shop/orders";
import { reserveVariant } from "@/lib/shop/reservations";
import type { PaymentDetails } from "@/lib/shop/settings";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import {
  checkPrompt,
  checkPromptForBuyer,
  promptsOffered,
  reconcilePrompts,
  requestPrompt,
} from "./stk";

cleanDatabaseBetweenTests();

const CONFIG: MpesaConfig = {
  environment: "sandbox",
  baseUrl: "https://sandbox.safaricom.co.ke",
  consumerKey: "key",
  consumerSecret: "secret",
  shortcode: "174379",
  passkey: "passkey",
  transactionType: "CustomerPayBillOnline",
  partyB: "174379",
  callbackUrl: "https://shop.example/api/payments/callback/s",
  callbackSecret: "s",
};

const TILL: PaymentDetails = {
  method: PaymentMethod.TILL,
  name: "The Thrift Plug",
  number: "5432100",
  accountNumber: null,
  note: null,
};

const PAID: StkVerdict = { state: "settled", resultCode: 0, resultDesc: "Processed" };
const CANCELLED: StkVerdict = {
  state: "settled",
  resultCode: 1032,
  resultDesc: "Request cancelled by user",
};

let run = 0;

/** A buyer at checkout: holding `stock` units of one product, order awaiting payment. */
async function atCheckout({ stock = 1, priceCents = 150_000 } = {}) {
  run += 1;
  const product = await makeProduct({ priceCents }, { stock });
  const buyer = await db.user.create({
    // Never signs in: no need to pay for argon2.
    data: { email: `buyer-${run}@example.com`, passwordHash: "not used" },
  });
  const cart = await resolveCart({ userId: buyer.id });
  await addToCart(cart.id, product.variantId);
  const checkout = await beginCheckout(buyer.id, cart.id, { name: "Grace", phone: "254712345678" });
  if (!checkout.ok) throw new Error("checkout failed");

  return {
    product,
    buyer,
    cartId: cart.id,
    orderId: checkout.orderId,
    reference: checkout.reference,
  };
}

/** A fake Safaricom that accepts every prompt, each with its own CheckoutRequestID. */
let prompts = 0;

function acceptingPush() {
  return vi.fn(async () => {
    // Shared across fakes: Safaricom never hands out the same ID twice.
    prompts += 1;
    return {
      ok: true as const,
      checkoutRequestId: `ws_CO_${prompts}`,
      merchantRequestId: `m${prompts}`,
    };
  });
}

async function promptSent(options: { stock?: number; priceCents?: number } = {}) {
  const ctx = await atCheckout(options);
  const result = await requestPrompt(
    { orderId: ctx.orderId, userId: ctx.buyer.id, phone: "0712 345 678", payment: TILL },
    { config: CONFIG, push: acceptingPush() },
  );
  if (!result.ok) throw new Error(`prompt refused: ${result.reason}`);
  const payment = await db.payment.findFirstOrThrow({ where: { orderId: ctx.orderId } });

  return { ...ctx, payment };
}

const answer = (verdict: StkVerdict) => ({ config: CONFIG, query: vi.fn(async () => verdict) });

function callbackFor(
  checkoutRequestId: string,
  resultCode: number,
  receipt = "UJ2LQ8HPVQ",
): StkCallback {
  return {
    checkoutRequestId,
    merchantRequestId: "m",
    resultCode,
    resultDesc: resultCode === 0 ? "Processed" : "Cancelled",
    amount: resultCode === 0 ? 1500 : null,
    receipt: resultCode === 0 ? receipt : null,
    phone: "254712345678",
  };
}

describe("promptsOffered", () => {
  it("is off without prompts switched on, and for Pochi, which has no API", () => {
    expect(promptsOffered(TILL, null)).toBe(false);
    expect(promptsOffered({ ...TILL, method: PaymentMethod.POCHI }, CONFIG)).toBe(false);
    expect(promptsOffered(null, CONFIG)).toBe(false);
    expect(promptsOffered(TILL, CONFIG)).toBe(true);
  });

  it("with live keys, needs the money to go where checkout says it goes", () => {
    const live = { ...CONFIG, environment: "production" as const, partyB: "5432100" };

    expect(promptsOffered(TILL, live)).toBe(true);
    expect(promptsOffered({ ...TILL, number: "9999999" }, live)).toBe(false);
  });
});

describe("requestPrompt", () => {
  it("sends the prompt for the order's total and records it as pending", async () => {
    const ctx = await atCheckout({ priceCents: 150_000 });
    const push = acceptingPush();

    const result = await requestPrompt(
      { orderId: ctx.orderId, userId: ctx.buyer.id, phone: "0712 345 678", payment: TILL },
      { config: CONFIG, push },
    );

    expect(result).toEqual({ ok: true, reference: ctx.reference });
    expect(push).toHaveBeenCalledWith(
      CONFIG,
      expect.objectContaining({ amount: 1500, phone: "254712345678", reference: ctx.reference }),
    );
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: ctx.orderId } });
    expect(payment).toMatchObject({
      channel: "MPESA_STK",
      status: PaymentStatus.PENDING,
      amountCents: 150_000,
      phone: "254712345678",
    });
    expect(payment.checkoutRequestId).toMatch(/^ws_CO_/);
  });

  it("keeps the hold for at least five minutes after the prompt, without shortening it", async () => {
    const ctx = await atCheckout();
    const now = new Date();
    // One minute left: not long enough to find the phone and type a PIN.
    await db.stockHold.updateMany({ data: { expiresAt: new Date(now.getTime() + 60_000) } });

    await requestPrompt(
      { orderId: ctx.orderId, userId: ctx.buyer.id, phone: "0712345678", payment: TILL },
      { config: CONFIG, push: acceptingPush(), now },
    );

    const hold = await db.stockHold.findFirstOrThrow();
    expect(hold.expiresAt).toEqual(new Date(now.getTime() + 5 * 60_000));
  });

  it("sends one prompt however many times the button is pressed", async () => {
    const ctx = await atCheckout();
    const push = acceptingPush();
    const input = {
      orderId: ctx.orderId,
      userId: ctx.buyer.id,
      phone: "0712345678",
      payment: TILL,
    };

    const results = await Promise.all([
      requestPrompt(input, { config: CONFIG, push }),
      requestPrompt(input, { config: CONFIG, push }),
      requestPrompt(input, { config: CONFIG, push }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "prompt-pending")).toHaveLength(2);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("refuses what it can't or shouldn't send", async () => {
    const ctx = await atCheckout();
    const input = {
      orderId: ctx.orderId,
      userId: ctx.buyer.id,
      phone: "0712345678",
      payment: TILL,
    };
    const push = acceptingPush();

    expect(await requestPrompt({ ...input, phone: "12345" }, { config: CONFIG, push })).toEqual({
      ok: false,
      reason: "bad-phone",
    });
    expect(await requestPrompt(input, { config: null, push })).toMatchObject({
      reason: "not-offered",
    });
    expect(
      await requestPrompt({ ...input, userId: "someone-else" }, { config: CONFIG, push }),
    ).toEqual({
      ok: false,
      reason: "not-found",
    });

    await db.stockHold.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await requestPrompt(input, { config: CONFIG, push })).toEqual({
      ok: false,
      reason: "hold-lapsed",
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("never rounds a total that isn't whole shillings", async () => {
    const ctx = await atCheckout({ priceCents: 150_050 });

    expect(
      await requestPrompt(
        { orderId: ctx.orderId, userId: ctx.buyer.id, phone: "0712345678", payment: TILL },
        { config: CONFIG, push: acceptingPush() },
      ),
    ).toEqual({ ok: false, reason: "odd-amount" });
  });

  it("records Safaricom's refusal, and lets the buyer try again", async () => {
    const ctx = await atCheckout();
    const input = {
      orderId: ctx.orderId,
      userId: ctx.buyer.id,
      phone: "0712345678",
      payment: TILL,
    };

    const refused = await requestPrompt(input, {
      config: CONFIG,
      push: async () => ({ ok: false, detail: "Bad Request - Invalid PhoneNumber" }),
    });

    expect(refused).toEqual({
      ok: false,
      reason: "refused",
      detail: "Bad Request - Invalid PhoneNumber",
    });
    expect(await db.payment.findFirstOrThrow()).toMatchObject({
      status: PaymentStatus.FAILED,
      resultDesc: "Bad Request - Invalid PhoneNumber",
    });
    expect((await requestPrompt(input, { config: CONFIG, push: acceptingPush() })).ok).toBe(true);
  });
});

describe("settling a prompt", () => {
  it("sells the order when Safaricom says it was paid", async () => {
    const ctx = await promptSent();

    const result = await checkPrompt(
      ctx.payment.id,
      SettledVia.CALLBACK,
      { callback: callbackFor(ctx.payment.checkoutRequestId!, 0) },
      answer(PAID),
    );

    expect(result).toEqual({ changed: true, status: PaymentStatus.RECEIVED, outcome: "confirmed" });
    const order = await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } });
    expect(order).toMatchObject({ status: OrderStatus.CONFIRMED, mpesaCode: "UJ2LQ8HPVQ" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: ctx.payment.id } })).toMatchObject({
      status: PaymentStatus.RECEIVED,
      receipt: "UJ2LQ8HPVQ",
      settledVia: SettledVia.CALLBACK,
      resultCode: 0,
    });
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: ctx.product.variantId } })).stock,
    ).toBe(0);
    // Bought, so out of the cart; and recorded as done by M-Pesa, not a person.
    expect(await db.cartItem.count({ where: { cartId: ctx.cartId } })).toBe(0);
    expect(await db.auditLog.findFirstOrThrow({ where: { entityId: ctx.orderId } })).toMatchObject({
      action: "order.prompt-paid",
      actorId: null,
    });
  });

  it("refuses a forged 'paid' when Safaricom says it wasn't", async () => {
    // Anyone can post to the callback, and the CheckoutRequestID is no secret.
    const ctx = await promptSent();

    await checkPrompt(
      ctx.payment.id,
      SettledVia.CALLBACK,
      { callback: callbackFor(ctx.payment.checkoutRequestId!, 0) },
      answer(CANCELLED),
    );

    expect((await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      OrderStatus.AWAITING_PAYMENT,
    );
    expect(await db.payment.findUniqueOrThrow({ where: { id: ctx.payment.id } })).toMatchObject({
      status: PaymentStatus.FAILED,
      receipt: null,
    });
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: ctx.product.variantId } })).stock,
    ).toBe(1);
  });

  it("doesn't let a forged 'cancelled' undo a real payment", async () => {
    const ctx = await promptSent();

    await checkPrompt(
      ctx.payment.id,
      SettledVia.CALLBACK,
      { callback: callbackFor(ctx.payment.checkoutRequestId!, 1032) },
      answer(PAID),
    );

    expect((await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      OrderStatus.CONFIRMED,
    );
  });

  it("changes nothing while Safaricom is unreachable or the prompt is still going", async () => {
    const ctx = await promptSent();

    for (const verdict of [
      { state: "unknown", detail: "ECONNRESET" },
      { state: "processing" },
    ] as StkVerdict[]) {
      expect(
        await checkPrompt(
          ctx.payment.id,
          SettledVia.CALLBACK,
          { callback: callbackFor(ctx.payment.checkoutRequestId!, 0) },
          answer(verdict),
        ),
      ).toEqual({ changed: false, status: PaymentStatus.PENDING });
    }

    const payment = await db.payment.findUniqueOrThrow({ where: { id: ctx.payment.id } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.checkedAt).toBeInstanceOf(Date);
    // Kept for disputes, even though it changed nothing.
    expect(payment.callback).toMatchObject({ resultCode: 0 });
  });

  it("settles once when the callback, the page and the housekeeping race", async () => {
    const ctx = await promptSent({ stock: 3 });

    const results = await Promise.all([
      checkPrompt(ctx.payment.id, SettledVia.CALLBACK, {}, answer(PAID)),
      checkPrompt(ctx.payment.id, SettledVia.BUYER_PAGE, {}, answer(PAID)),
      checkPrompt(ctx.payment.id, SettledVia.HOUSEKEEPING, {}, answer(PAID)),
    ]);

    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: ctx.product.variantId } })).stock,
    ).toBe(2);
    expect(await db.stockMovement.count({ where: { orderId: ctx.orderId } })).toBe(1);
  });

  it("leaves a not-paid order open, so the buyer can try again", async () => {
    const ctx = await promptSent();

    await checkPrompt(ctx.payment.id, SettledVia.BUYER_PAGE, {}, answer(CANCELLED));

    expect((await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      OrderStatus.AWAITING_PAYMENT,
    );
    const again = await requestPrompt(
      { orderId: ctx.orderId, userId: ctx.buyer.id, phone: "0712345678", payment: TILL },
      { config: CONFIG, push: acceptingPush() },
    );
    expect(again.ok).toBe(true);
  });

  it("owes the money back when the hold lapsed and the unit went to someone else", async () => {
    const ctx = await promptSent();
    await db.stockHold.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await reserveVariant(ctx.product.variantId, "next-buyer")).ok).toBe(true);

    const result = await checkPrompt(ctx.payment.id, SettledVia.HOUSEKEEPING, {}, answer(PAID));

    expect(result.outcome).toBe("needs-refund");
    expect((await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      OrderStatus.NEEDS_REFUND,
    );
    // The other buyer keeps their hold.
    expect(await db.stockHold.count({ where: { holder: "next-buyer" } })).toBe(1);
  });

  it("still sells an order closed while its prompt was out, if the unit is free", async () => {
    const ctx = await promptSent();
    await db.order.update({ where: { id: ctx.orderId }, data: { status: OrderStatus.CANCELLED } });

    await checkPrompt(ctx.payment.id, SettledVia.HOUSEKEEPING, {}, answer(PAID));

    expect((await db.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      OrderStatus.CONFIRMED,
    );
  });

  it("settles without a receipt rather than take one another payment already has", async () => {
    const first = await promptSent();
    await checkPrompt(
      first.payment.id,
      SettledVia.CALLBACK,
      { callback: callbackFor(first.payment.checkoutRequestId!, 0, "UJ2LQ8HPVQ") },
      answer(PAID),
    );
    const second = await promptSent();

    await checkPrompt(
      second.payment.id,
      SettledVia.CALLBACK,
      { callback: callbackFor(second.payment.checkoutRequestId!, 0, "UJ2LQ8HPVQ") },
      answer(PAID),
    );

    expect(await db.payment.findUniqueOrThrow({ where: { id: second.payment.id } })).toMatchObject({
      status: PaymentStatus.RECEIVED,
      receipt: null,
    });
  });
});

describe("while a prompt is out", () => {
  it("refuses a typed code, so the buyer can't pay twice", async () => {
    const ctx = await promptSent();

    expect(await claimPayment(ctx.orderId, ctx.buyer.id, "SGH7XKL2M9")).toEqual({
      ok: false,
      reason: "prompt-pending",
    });
  });

  it("sends checkout to the order's page instead of rebuilding the order", async () => {
    const ctx = await promptSent();

    expect(
      await beginCheckout(ctx.buyer.id, ctx.cartId, { name: "Grace", phone: "254712345678" }),
    ).toEqual({
      ok: false,
      reason: "prompt-pending",
      reference: ctx.reference,
    });
  });
});

describe("asking on the buyer's behalf", () => {
  it("leaves a fresh prompt alone, then asks, then spaces its questions", async () => {
    const ctx = await promptSent();
    const sentAt = ctx.payment.createdAt.getTime();
    const deps = answer({ state: "processing" });

    // Ten seconds in: still typing the PIN.
    await checkPromptForBuyer(ctx.reference, ctx.buyer.id, {
      ...deps,
      now: new Date(sentAt + 10_000),
    });
    expect(deps.query).not.toHaveBeenCalled();

    await checkPromptForBuyer(ctx.reference, ctx.buyer.id, {
      ...deps,
      now: new Date(sentAt + 25_000),
    });
    expect(deps.query).toHaveBeenCalledTimes(1);

    // Polled again three seconds later: too soon to ask Safaricom again.
    const checkedAt = (await db.payment.findUniqueOrThrow({ where: { id: ctx.payment.id } }))
      .checkedAt!;
    await checkPromptForBuyer(ctx.reference, ctx.buyer.id, {
      ...deps,
      now: new Date(checkedAt.getTime() + 3_000),
    });
    expect(deps.query).toHaveBeenCalledTimes(1);
  });

  it("reports the result once Safaricom has one", async () => {
    const ctx = await promptSent();

    const state = await checkPromptForBuyer(ctx.reference, ctx.buyer.id, {
      ...answer(PAID),
      now: new Date(Date.now() + 30_000),
    });

    expect(state).toEqual({ order: OrderStatus.CONFIRMED, prompt: PaymentStatus.RECEIVED });
  });

  it("shows nobody else's order", async () => {
    const ctx = await promptSent();

    expect(await checkPromptForBuyer(ctx.reference, "someone-else", answer(PAID))).toBeNull();
  });
});

describe("reconcilePrompts", () => {
  it("settles prompts nobody settled, and leaves fresh ones alone", async () => {
    const old = await promptSent();
    await db.payment.update({
      where: { id: old.payment.id },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    const fresh = await promptSent();

    expect(await reconcilePrompts(answer(PAID))).toBe(1);

    expect((await db.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).settledVia).toBe(
      SettledVia.HOUSEKEEPING,
    );
    expect((await db.payment.findUniqueOrThrow({ where: { id: fresh.payment.id } })).status).toBe(
      PaymentStatus.PENDING,
    );
  });
});
