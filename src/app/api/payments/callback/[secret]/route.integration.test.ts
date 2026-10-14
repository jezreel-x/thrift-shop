import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { addToCart, resolveCart } from "@/lib/shop/cart";
import { beginCheckout } from "@/lib/shop/orders";
import { makeProduct } from "@/test/catalogue";
import { cleanDatabaseBetweenTests, db } from "@/test/db";
import { POST } from "./route";

// Safaricom's answer to "how did this prompt end?", set per test. Everything
// else in the Daraja client is real.
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mpesa/daraja", async (original) => ({
  ...(await original<typeof import("@/lib/mpesa/daraja")>()),
  stkQuery: query,
}));

cleanDatabaseBetweenTests();

const SECRET = "c".repeat(32);

beforeEach(() => {
  vi.stubEnv("MPESA_ENABLED", "true");
  vi.stubEnv("MPESA_ENV", "sandbox");
  vi.stubEnv("MPESA_CONSUMER_KEY", "key");
  vi.stubEnv("MPESA_CONSUMER_SECRET", "secret");
  vi.stubEnv("MPESA_SHORTCODE", "174379");
  vi.stubEnv("MPESA_PASSKEY", "passkey");
  vi.stubEnv("MPESA_CALLBACK_BASE_URL", "https://shop.example");
  vi.stubEnv("MPESA_CALLBACK_SECRET", SECRET);
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
});

/** An order with a prompt out, as if requestPrompt had sent it. */
async function promptOut() {
  const product = await makeProduct({ priceCents: 150_000 });
  const buyer = await db.user.create({ data: { email: "grace@example.com", passwordHash: "x" } });
  const cart = await resolveCart({ userId: buyer.id });
  await addToCart(cart.id, product.variantId);
  const checkout = await beginCheckout(buyer.id, cart.id, { name: "Grace", phone: "254712345678" });
  if (!checkout.ok) throw new Error("checkout failed");
  await db.payment.create({
    data: {
      orderId: checkout.orderId,
      channel: "MPESA_STK",
      status: PaymentStatus.PENDING,
      amountCents: 150_000,
      phone: "254712345678",
      checkoutRequestId: "ws_CO_TEST_1",
    },
  });

  return { orderId: checkout.orderId };
}

function post(secret: string, body: unknown) {
  return POST(
    new Request(`https://shop.example/api/payments/callback/${secret}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ secret }) },
  );
}

const PAID_CALLBACK = {
  Body: {
    stkCallback: {
      MerchantRequestID: "m",
      CheckoutRequestID: "ws_CO_TEST_1",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1500 },
          { Name: "MpesaReceiptNumber", Value: "UJ2LQ8HPVQ" },
          { Name: "PhoneNumber", Value: 254712345678 },
        ],
      },
    },
  },
};

describe("the M-Pesa callback", () => {
  it("is a 404 without the secret, and settles nothing", async () => {
    const { orderId } = await promptOut();

    const response = await post("c".repeat(31) + "d", PAID_CALLBACK);

    expect(response.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.AWAITING_PAYMENT,
    );
  });

  it("confirms the order when Safaricom agrees it was paid", async () => {
    const { orderId } = await promptOut();
    query.mockResolvedValue({ state: "settled", resultCode: 0, resultDesc: "Processed" });

    const response = await post(SECRET, PAID_CALLBACK);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(query).toHaveBeenCalledWith(expect.anything(), "ws_CO_TEST_1");
    expect(await db.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: OrderStatus.CONFIRMED,
      mpesaCode: "UJ2LQ8HPVQ",
    });
  });

  it("ignores a forged 'paid' that Safaricom doesn't confirm, and still answers 200", async () => {
    const { orderId } = await promptOut();
    query.mockResolvedValue({ state: "settled", resultCode: 1032, resultDesc: "Cancelled" });

    const response = await post(SECRET, PAID_CALLBACK);

    expect(response.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.AWAITING_PAYMENT,
    );
  });

  it("answers 200 to a retry, and settles only once", async () => {
    const { orderId } = await promptOut();
    query.mockResolvedValue({ state: "settled", resultCode: 0, resultDesc: "Processed" });

    await post(SECRET, PAID_CALLBACK);
    const retry = await post(SECRET, PAID_CALLBACK);

    expect(retry.status).toBe(200);
    expect(await db.stockMovement.count({ where: { orderId } })).toBe(1);
  });

  it("answers 200 to a prompt it never sent, or to junk", async () => {
    const unknown = structuredClone(PAID_CALLBACK);
    unknown.Body.stkCallback.CheckoutRequestID = "ws_CO_NOT_OURS";

    expect((await post(SECRET, unknown)).status).toBe(200);
    expect((await post(SECRET, { hello: "world" })).status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });
});
