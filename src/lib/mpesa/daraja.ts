import type { MpesaConfig } from "./config";

/**
 * Safaricom's Daraja API: just the three calls STK Push needs, over plain
 * fetch. The npm wrappers for Daraja are mostly unmaintained, and these calls
 * are small enough to read in one sitting.
 *
 *   token  — OAuth client credentials, cached until shortly before it expires
 *   push   — send the PIN prompt to a phone
 *   query  — ask how a prompt ended
 *
 * Nothing here touches the database. Settling what Safaricom says is
 * src/lib/payments/stk.ts.
 */

type Fetch = typeof fetch;

/** Every call gives up after this long, so a slow Safaricom can't hang a page. */
const TIMEOUT_MS = 10_000;

// --- The password -----------------------------------------------------------

/**
 * Daraja's timestamp, YYYYMMDDHHmmss in Nairobi time. Safaricom checks it
 * against its own clock, and Kenya keeps no daylight saving, so a fixed +3h is
 * exact.
 */
export function darajaTimestamp(now: Date = new Date()): string {
  const nairobi = new Date(now.getTime() + 3 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${nairobi.getUTCFullYear()}${pad(nairobi.getUTCMonth() + 1)}${pad(nairobi.getUTCDate())}` +
    `${pad(nairobi.getUTCHours())}${pad(nairobi.getUTCMinutes())}${pad(nairobi.getUTCSeconds())}`
  );
}

/** base64(shortcode + passkey + timestamp), as Daraja defines it. */
export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

// --- The token --------------------------------------------------------------

let cached: { key: string; token: string; expiresAt: number } | null = null;

/** Tokens last about an hour; one is reused until a minute before it runs out. */
async function accessToken(config: MpesaConfig, fetchImpl: Fetch): Promise<string> {
  const key = `${config.environment}:${config.consumerKey}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const response = await fetchImpl(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: string | number;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`Daraja refused the token request (HTTP ${response.status}).`);
  }

  cached = {
    key,
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in ?? 3599) * 1000,
  };

  return cached.token;
}

/** For tests: forget the cached token. */
export function forgetToken() {
  cached = null;
}

// --- Sending a prompt -------------------------------------------------------

export type PushResult =
  | { ok: true; checkoutRequestId: string; merchantRequestId: string }
  | { ok: false; detail: string };

/**
 * Sends the PIN prompt. Success here only means Safaricom accepted the request:
 * the prompt is on its way. Whether it is paid comes later, from the callback
 * or from {@link stkQuery}.
 */
export async function stkPush(
  config: MpesaConfig,
  input: {
    /** Whole shillings: Daraja takes no cents. */
    amount: number;
    /** 2547XXXXXXXX or 2541XXXXXXXX. */
    phone: string;
    /** Shown to the buyer in the prompt and their M-Pesa message; 12 characters at most. */
    reference: string;
    description: string;
  },
  fetchImpl: Fetch = fetch,
  now: Date = new Date(),
): Promise<PushResult> {
  try {
    const token = await accessToken(config, fetchImpl);
    const timestamp = darajaTimestamp(now);
    const response = await fetchImpl(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: darajaPassword(config.shortcode, config.passkey, timestamp),
        Timestamp: timestamp,
        TransactionType: config.transactionType,
        Amount: input.amount,
        PartyA: input.phone,
        PartyB: config.partyB,
        PhoneNumber: input.phone,
        CallBackURL: config.callbackUrl,
        AccountReference: input.reference.slice(0, 12),
        TransactionDesc: input.description.slice(0, 13),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (String(body.ResponseCode ?? "") === "0" && typeof body.CheckoutRequestID === "string") {
      return {
        ok: true,
        checkoutRequestId: body.CheckoutRequestID,
        merchantRequestId: String(body.MerchantRequestID ?? ""),
      };
    }

    return {
      ok: false,
      detail: String(
        body.errorMessage ?? body.ResponseDescription ?? `Daraja answered HTTP ${response.status}`,
      ),
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// --- Asking how a prompt ended ----------------------------------------------

/**
 * Safaricom's answer, in the three shapes that matter:
 *
 *   settled    — it ended: code 0 paid, anything else not paid
 *   processing — not over yet: ask again later
 *   unknown    — no usable answer (Safaricom down, throttled, a timeout): ask
 *                again later
 *
 * Only "settled" ever changes anything. Treating "not over yet" as a failure
 * is the expensive mistake: the buyer sees "failed", pays again, and has paid
 * twice.
 */
export type StkVerdict =
  | { state: "settled"; resultCode: number; resultDesc: string }
  | { state: "processing" }
  | { state: "unknown"; detail: string };

/** Daraja's error code for a query about a prompt that is still in progress. */
const IN_PROGRESS_ERROR = "500.001.1001";

/**
 * Daraja also reports "still in progress" in its success shape: ResponseCode 0,
 * a non-zero ResultCode, and a description saying so. Read literally, that is
 * a settled failure. Matched on the description because the code alone does
 * not tell the two apart.
 */
const STILL_GOING = /still under process|being processed|in progress/i;

/** Sorts a query response into a verdict. Pure, so every shape is testable. */
export function classifyQuery(httpOk: boolean, body: Record<string, unknown>): StkVerdict {
  if (String(body.errorCode ?? "") === IN_PROGRESS_ERROR) return { state: "processing" };
  if (!httpOk) {
    return { state: "unknown", detail: String(body.errorMessage ?? "Daraja refused the query") };
  }
  if (String(body.ResponseCode ?? "") !== "0" || body.ResultCode === undefined) {
    return {
      state: "unknown",
      detail: String(body.ResponseDescription ?? "Daraja gave no result"),
    };
  }

  const resultCode = Number(body.ResultCode);
  const resultDesc = String(body.ResultDesc ?? "");
  if (Number.isNaN(resultCode))
    return { state: "unknown", detail: "Daraja's result was not a number" };
  // A success is a success however it is worded; only a non-zero code can be
  // "still going" in disguise.
  if (resultCode !== 0 && STILL_GOING.test(resultDesc)) return { state: "processing" };

  return { state: "settled", resultCode, resultDesc };
}

export async function stkQuery(
  config: MpesaConfig,
  checkoutRequestId: string,
  fetchImpl: Fetch = fetch,
  now: Date = new Date(),
): Promise<StkVerdict> {
  try {
    const token = await accessToken(config, fetchImpl);
    const timestamp = darajaTimestamp(now);
    const response = await fetchImpl(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: darajaPassword(config.shortcode, config.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    return classifyQuery(response.ok, body);
  } catch (error) {
    return { state: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

// --- Reading a callback -----------------------------------------------------

export type StkCallback = {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: number;
  resultDesc: string;
  /** Present on a paid prompt only. */
  amount: number | null;
  receipt: string | null;
  phone: string | null;
};

/**
 * Pulls the fields out of Safaricom's callback body. Returns null for anything
 * that isn't one. What it returns is a claim, not a fact: anyone can post to
 * the callback URL, so it is checked with {@link stkQuery} before it counts.
 */
export function parseCallback(body: unknown): StkCallback | null {
  const callback = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body
    ?.stkCallback;
  if (!callback || typeof callback.CheckoutRequestID !== "string") return null;

  const resultCode = Number(callback.ResultCode);
  if (Number.isNaN(resultCode)) return null;

  const items =
    (callback.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)
      ?.Item ?? [];
  const item = (name: string) => items.find((entry) => entry.Name === name)?.Value;
  const amount = Number(item("Amount"));
  const receipt = item("MpesaReceiptNumber");
  const phone = item("PhoneNumber");

  return {
    checkoutRequestId: callback.CheckoutRequestID,
    merchantRequestId: String(callback.MerchantRequestID ?? ""),
    resultCode,
    resultDesc: String(callback.ResultDesc ?? ""),
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    receipt: typeof receipt === "string" && /^[A-Z0-9]{10}$/.test(receipt) ? receipt : null,
    phone: phone === undefined ? null : String(phone),
  };
}
