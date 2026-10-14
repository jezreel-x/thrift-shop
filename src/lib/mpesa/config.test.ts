import { beforeEach, describe, expect, it, vi } from "vitest";

import { mpesaConfig } from "./config";

const SANDBOX: Record<string, string | undefined> = {
  MPESA_ENABLED: "true",
  MPESA_ENV: "sandbox",
  MPESA_CONSUMER_KEY: "key",
  MPESA_CONSUMER_SECRET: "secret",
  MPESA_SHORTCODE: "174379",
  MPESA_PASSKEY: "passkey",
  MPESA_CALLBACK_BASE_URL: "https://preview.example.com/",
  MPESA_CALLBACK_SECRET: "a".repeat(32),
};

describe("mpesaConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("builds the sandbox config, with the secret in the callback's path", () => {
    expect(mpesaConfig(SANDBOX)).toMatchObject({
      environment: "sandbox",
      baseUrl: "https://sandbox.safaricom.co.ke",
      transactionType: "CustomerPayBillOnline",
      partyB: "174379",
      callbackUrl: `https://preview.example.com/api/payments/callback/${"a".repeat(32)}`,
    });
  });

  it("stays off unless switched on, whatever keys are present", () => {
    // Keys in a .env must never be enough to send real prompts.
    expect(mpesaConfig({ ...SANDBOX, MPESA_ENABLED: undefined })).toBeNull();
    expect(mpesaConfig({ ...SANDBOX, MPESA_ENABLED: "1" })).toBeNull();
  });

  it("refuses sandbox keys on Vercel's production environment", () => {
    expect(mpesaConfig({ ...SANDBOX, VERCEL_ENV: "production" })).toBeNull();
    expect(mpesaConfig({ ...SANDBOX, VERCEL_ENV: "preview" })).not.toBeNull();
  });

  it("allows live keys on production", () => {
    expect(
      mpesaConfig({ ...SANDBOX, MPESA_ENV: "production", VERCEL_ENV: "production" })?.baseUrl,
    ).toBe("https://api.safaricom.co.ke");
  });

  it("stays off when anything is missing or unsafe", () => {
    expect(mpesaConfig({ ...SANDBOX, MPESA_ENV: "live" })).toBeNull();
    expect(mpesaConfig({ ...SANDBOX, MPESA_PASSKEY: "" })).toBeNull();
    expect(
      mpesaConfig({ ...SANDBOX, MPESA_CALLBACK_BASE_URL: "http://plain.example.com" }),
    ).toBeNull();
    expect(mpesaConfig({ ...SANDBOX, MPESA_CALLBACK_SECRET: "short" })).toBeNull();
  });

  it("pays a till with Buy Goods when a till number is set", () => {
    expect(mpesaConfig({ ...SANDBOX, MPESA_TILL_NUMBER: "5432100" })).toMatchObject({
      transactionType: "CustomerBuyGoodsOnline",
      partyB: "5432100",
      shortcode: "174379",
    });
  });
});
