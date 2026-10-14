import { afterEach, describe, expect, it, vi } from "vitest";

import type { MpesaConfig } from "./config";
import {
  classifyQuery,
  darajaPassword,
  darajaTimestamp,
  forgetToken,
  parseCallback,
  stkPush,
  stkQuery,
} from "./daraja";

const CONFIG: MpesaConfig = {
  environment: "sandbox",
  baseUrl: "https://sandbox.safaricom.co.ke",
  consumerKey: "key",
  consumerSecret: "secret",
  shortcode: "174379",
  passkey: "passkey",
  transactionType: "CustomerPayBillOnline",
  partyB: "174379",
  callbackUrl: "https://shop.example/api/payments/callback/xxxxxxxxxxxxxxxxxxxxxxxx",
  callbackSecret: "xxxxxxxxxxxxxxxxxxxxxxxx",
};

describe("the password", () => {
  it("stamps Nairobi time, which is UTC+3 all year", () => {
    expect(darajaTimestamp(new Date("2026-10-14T21:05:09Z"))).toBe("20261015000509");
  });

  it("is base64 of shortcode, passkey and timestamp", () => {
    const password = darajaPassword("174379", "pk", "20261014120000");

    expect(Buffer.from(password, "base64").toString()).toBe("174379pk20261014120000");
  });
});

describe("classifyQuery", () => {
  it("settles a paid prompt", () => {
    expect(
      classifyQuery(true, {
        ResponseCode: "0",
        ResultCode: "0",
        ResultDesc: "The service request is processed successfully.",
      }),
    ).toEqual({
      state: "settled",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
    });
  });

  it("settles a cancelled prompt as not paid", () => {
    expect(
      classifyQuery(true, {
        ResponseCode: "0",
        ResultCode: "1032",
        ResultDesc: "Request cancelled by user",
      }),
    ).toMatchObject({ state: "settled", resultCode: 1032 });
  });

  it("reads Daraja's in-progress error as still going, not failed", () => {
    expect(
      classifyQuery(false, {
        errorCode: "500.001.1001",
        errorMessage: "The transaction is being processed",
      }),
    ).toEqual({ state: "processing" });
  });

  it("reads 'still under processing' in the success shape as still going", () => {
    // The trap: ResponseCode 0 and a non-zero ResultCode looks like a settled
    // failure. Believing it tells a buyer who is about to pay that they failed.
    for (const desc of [
      "The transaction is still under processing",
      "The transaction is being processed",
      "Transaction in progress",
    ]) {
      expect(
        classifyQuery(true, { ResponseCode: "0", ResultCode: "4999", ResultDesc: desc }),
      ).toEqual({
        state: "processing",
      });
    }
  });

  it("never reads a success as still going, however it is worded", () => {
    expect(
      classifyQuery(true, {
        ResponseCode: "0",
        ResultCode: "0",
        ResultDesc: "Processed, in progress",
      }),
    ).toMatchObject({ state: "settled", resultCode: 0 });
  });

  it("says unknown, not failed, when Daraja gives no usable answer", () => {
    expect(classifyQuery(false, { errorMessage: "Invalid Access Token" })).toMatchObject({
      state: "unknown",
    });
    expect(classifyQuery(true, {})).toMatchObject({ state: "unknown" });
    expect(classifyQuery(true, { ResponseCode: "0", ResultCode: "abc" })).toMatchObject({
      state: "unknown",
    });
  });
});

describe("parseCallback", () => {
  const paid = {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: "ws_CO_191220191020363925",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 1500 },
            { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
            { Name: "TransactionDate", Value: 20191219102115 },
            { Name: "PhoneNumber", Value: 254708374149 },
          ],
        },
      },
    },
  };

  it("reads a paid prompt", () => {
    expect(parseCallback(paid)).toEqual({
      checkoutRequestId: "ws_CO_191220191020363925",
      merchantRequestId: "29115-34620561-1",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      amount: 1500,
      receipt: "NLJ7RT61SV",
      phone: "254708374149",
    });
  });

  it("reads a cancelled prompt, which carries no metadata", () => {
    expect(
      parseCallback({
        Body: {
          stkCallback: {
            MerchantRequestID: "m",
            CheckoutRequestID: "ws_CO_1",
            ResultCode: 1032,
            ResultDesc: "Request cancelled by user",
          },
        },
      }),
    ).toMatchObject({ resultCode: 1032, amount: null, receipt: null });
  });

  it("ignores anything that isn't a callback", () => {
    expect(parseCallback(null)).toBeNull();
    expect(parseCallback({ hello: "world" })).toBeNull();
    expect(parseCallback({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull();
  });

  it("drops a receipt that isn't shaped like one", () => {
    const odd = structuredClone(paid);
    odd.Body.stkCallback.CallbackMetadata.Item[1].Value = "<script>";

    expect(parseCallback(odd)?.receipt).toBeNull();
  });
});

describe("calling Daraja", () => {
  afterEach(() => forgetToken());

  /** A fake Daraja: the token, then whatever `reply` says. */
  function fakeDaraja(reply: { status: number; body: unknown }) {
    return vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/oauth/")
        ? Response.json({ access_token: "token", expires_in: "3599" })
        : Response.json(reply.body, { status: reply.status }),
    ) as unknown as typeof fetch;
  }

  it("returns the CheckoutRequestID of an accepted prompt", async () => {
    const fetchImpl = fakeDaraja({
      status: 200,
      body: { ResponseCode: "0", CheckoutRequestID: "ws_CO_1", MerchantRequestID: "m1" },
    });

    expect(
      await stkPush(
        CONFIG,
        { amount: 1, phone: "254708374149", reference: "TP-ABC234", description: "x" },
        fetchImpl,
      ),
    ).toEqual({ ok: true, checkoutRequestId: "ws_CO_1", merchantRequestId: "m1" });
  });

  it("sends the amount, the phone and our callback, and keeps the reference within 12 characters", async () => {
    const fetchImpl = fakeDaraja({
      status: 200,
      body: { ResponseCode: "0", CheckoutRequestID: "c" },
    });

    await stkPush(
      CONFIG,
      {
        amount: 1500,
        phone: "254712345678",
        reference: "TP-ABC234-TOO-LONG",
        description: "Order",
      },
      fetchImpl,
    );

    const call = vi
      .mocked(fetchImpl)
      .mock.calls.find(([url]) => String(url).includes("processrequest"));
    const sent = JSON.parse(String(call?.[1]?.body));
    expect(sent).toMatchObject({
      Amount: 1500,
      PartyA: "254712345678",
      PhoneNumber: "254712345678",
      PartyB: "174379",
      TransactionType: "CustomerPayBillOnline",
      CallBackURL: CONFIG.callbackUrl,
      AccountReference: "TP-ABC234-TO",
    });
  });

  it("reports Safaricom's refusal in its own words", async () => {
    const fetchImpl = fakeDaraja({
      status: 400,
      body: { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" },
    });

    expect(
      await stkPush(
        CONFIG,
        { amount: 1, phone: "254700000000", reference: "TP-ABC234", description: "x" },
        fetchImpl,
      ),
    ).toEqual({ ok: false, detail: "Bad Request - Invalid PhoneNumber" });
  });

  it("turns a network failure into 'unknown', never into 'not paid'", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    expect(await stkQuery(CONFIG, "ws_CO_1", fetchImpl)).toEqual({
      state: "unknown",
      detail: "ECONNRESET",
    });
  });

  it("reuses one token across calls", async () => {
    const fetchImpl = fakeDaraja({ status: 200, body: { ResponseCode: "0", ResultCode: "0" } });

    await stkQuery(CONFIG, "a", fetchImpl);
    await stkQuery(CONFIG, "b", fetchImpl);

    const tokenCalls = vi
      .mocked(fetchImpl)
      .mock.calls.filter(([url]) => String(url).includes("/oauth/"));
    expect(tokenCalls).toHaveLength(1);
  });
});
