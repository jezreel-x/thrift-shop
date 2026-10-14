/**
 * Whether the shop may send M-Pesa prompts, and with what.
 *
 * Two rules decide it, and both fail closed (no prompts, the manual flow
 * carries on):
 *
 *  - Turning prompts on is its own switch, MPESA_ENABLED=true. Having keys is
 *    not enough: keys sitting in a developer's .env, or copied into the wrong
 *    Vercel environment, must never start sending real prompts on their own.
 *  - Sandbox keys never run in production. With them, a buyer on the live site
 *    would get a real-looking prompt, enter their PIN, and Safaricom's sandbox
 *    would report success for money that never moved. So MPESA_ENV=sandbox on
 *    Vercel's production environment turns prompts off, loudly.
 *
 * See docs/mpesa-stk-push.md for every variable and where each one lives.
 */

export type MpesaEnvironment = "sandbox" | "production";

export type MpesaConfig = {
  environment: MpesaEnvironment;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** The business shortcode the password is made from. */
  shortcode: string;
  passkey: string;
  /** A paybill takes CustomerPayBillOnline; a till CustomerBuyGoodsOnline. */
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  /** Where the money goes: the paybill itself, or the till. */
  partyB: string;
  /** Where Safaricom posts the result. Carries a secret in its path. */
  callbackUrl: string;
  callbackSecret: string;
};

const BASE_URLS: Record<MpesaEnvironment, string> = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
};

export function mpesaConfig(
  env: Record<string, string | undefined> = process.env,
): MpesaConfig | null {
  if (env.MPESA_ENABLED !== "true") return null;

  const environment = env.MPESA_ENV;
  if (environment !== "sandbox" && environment !== "production") {
    console.error("M-Pesa prompts are off: MPESA_ENV must be 'sandbox' or 'production'.");
    return null;
  }
  if (environment === "sandbox" && env.VERCEL_ENV === "production") {
    console.error("M-Pesa prompts are off: sandbox keys refuse to run on production.");
    return null;
  }

  const consumerKey = env.MPESA_CONSUMER_KEY;
  const consumerSecret = env.MPESA_CONSUMER_SECRET;
  const shortcode = env.MPESA_SHORTCODE;
  const passkey = env.MPESA_PASSKEY;
  const callbackBase = env.MPESA_CALLBACK_BASE_URL;
  const callbackSecret = env.MPESA_CALLBACK_SECRET;
  if (
    !consumerKey ||
    !consumerSecret ||
    !shortcode ||
    !passkey ||
    !callbackBase ||
    !callbackSecret
  ) {
    console.error("M-Pesa prompts are off: an MPESA_* variable is missing.");
    return null;
  }
  // Safaricom only posts to HTTPS, and a guessable path is an open door.
  if (!callbackBase.startsWith("https://") || callbackSecret.length < 24) {
    console.error(
      "M-Pesa prompts are off: the callback must be HTTPS, with a secret of 24+ characters.",
    );
    return null;
  }

  const till = env.MPESA_TILL_NUMBER;

  return {
    environment,
    baseUrl: BASE_URLS[environment],
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    transactionType: till ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    partyB: till || shortcode,
    // Named for nothing in particular: Safaricom rejects callback URLs that
    // contain words like "mpesa" or "safaricom".
    callbackUrl: `${callbackBase.replace(/\/+$/, "")}/api/payments/callback/${callbackSecret}`,
    callbackSecret,
  };
}
