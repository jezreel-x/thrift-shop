# M-Pesa STK Push

> **Status:** built in the sandbox (P2, 14 October 2026): the Daraja client
> (`src/lib/mpesa/`), sending and settling prompts (`src/lib/payments/stk.ts`),
> the callback (`/api/payments/callback/[secret]`), the buyer's waiting page,
> and staff's **Check M-Pesa status**. Verifying typed codes (C2B, below) is
> P3. Going live is P5. See [payments.md](payments.md).
>
> The sections after "What was built" are the original plan, kept for its
> reasoning; where the build differs, "What was built" wins.

## What was built

**Asking Safaricom is the main path; the callback is a shortcut.** A callback
can simply never arrive (some bank-managed paybills only deliver results to the
bank's own endpoint), and it is a public URL anyone can post to. So every path
that learns how a prompt ended goes through one function, `checkPrompt`, which
asks Safaricom (STK Query) and settles on that answer:

| Path                   | When                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| Safaricom's callback   | as soon as it arrives, if it does                                   |
| The buyer's page       | polls every 4 s; asks Safaricom after 20 s, then at most every 10 s |
| Staff                  | **Check M-Pesa status** on the order                                |
| The daily housekeeping | any prompt still unsettled, before closing lapsed checkouts         |

A forged "paid" is refused, a forged "cancelled" can't undo a real payment,
and the payment's row is locked while it settles, so the four paths racing
each other settle it once.

**Safaricom's answer has three shapes, not two.** `classifyQuery` sorts it:

- **settled**: code 0 is paid; anything else (1032 cancelled, 1037 timed out,
  1 not enough money, 2001 wrong PIN) is not paid;
- **still going**: Daraja's error `500.001.1001`, _and_ a non-zero result
  whose description says it is still being processed. The second arrives in
  the success shape and reads like a failure. Believing it tells a buyer who is
  mid-payment that they failed, and they pay twice;
- **unknown**: no usable answer (down, throttled, a timeout).

Only "settled" changes anything; the other two are asked again later.

**A paid prompt settles by the one rule** in `settle.ts`: sold if the units are
still the buyer's or free, otherwise **Needs refund**. The order can be
`AWAITING_PAYMENT` or `CANCELLED` (its hold ran out while the prompt was out);
money arriving for an order already decided some other way is recorded,
audited as owed back, and changes nothing else.

**Sending is guarded.** The prompt is recorded as `PENDING` under the order's
row lock before Safaricom is called, so pressing the button three times sends
one prompt. While one is out, the buyer can't type a code too or rebuild the
order at checkout (checkout sends them to the order's page). Sending extends
the hold to at least five minutes from now: the one thing besides a typed code
that extends a hold. A total that isn't whole shillings is never rounded:
the prompt isn't offered.

**Data:** prompts are rows in `Payment` (channel `MPESA_STK`), not a separate
table: `checkoutRequestId` (unique), `merchantRequestId`, Safaricom's
`resultCode`/`resultDesc`, the `callback` as received, `checkedAt`, and on
every payment `settledVia` (callback, buyer's page, housekeeping, staff check,
or staff by hand) with `settledAt`, so "how many prompts did the callback
actually settle?" can be answered.

**Switches:** prompts need `MPESA_ENABLED=true` as well as keys, so keys left in
a `.env` never send prompts on their own; `MPESA_ENV=sandbox` refuses to run on
Vercel's production environment; with live keys, checkout offers the prompt
only if the money goes to the number checkout shows. Variables are listed in
`.env.example`.

**Not built, on purpose:** reviving a prompt already marked not paid. With the
three-shape classification, "not paid" means Safaricom said so; if that ever
proves wrong, staff can still settle the money by hand as a typed code.

Today the shop confirms every payment by hand. The buyer pays the till
themselves, types the M-Pesa code into checkout, and the owner matches it
against her SMS messages before the items are sold. That works, but it has two
costs: the owner is the bottleneck on every sale, and nothing stops an invented
code except her reading.

STK Push (Daraja's "Lipa Na M-Pesa Online") removes both. The shop sends a PIN
prompt to the buyer's phone, Safaricom tells the shop whether it was paid, and
the order confirms itself.

## Where it fits in the existing flow

The order lifecycle does not change shape. STK Push adds a faster path out of
`AWAITING_PAYMENT`:

```
                   ┌── STK Push succeeds ──────────────────────────► CONFIRMED
AWAITING_PAYMENT ──┤
                   └── buyer types a code ──► PENDING_CONFIRMATION ──► CONFIRMED / REJECTED
                                                (owner checks SMS)
```

1. The buyer taps **Pay with M-Pesa**. A server action sends an STK request to
   `Order.buyerPhone`, which is already stored as `2547…`, the format Daraja
   expects.
2. The buyer enters their PIN on their phone.
3. Safaricom calls our callback URL with the result.
4. On a verified success, every item is sold and the order goes straight to
   `CONFIRMED`. Nobody has to read an SMS.

## The manual flow stays

STK pushes fail for ordinary reasons: the phone is off, the prompt times out,
the SIM toolkit is flaky, the buyer is on Airtel. Callbacks occasionally never
arrive. The code-entry flow already handles all of this, so it remains
underneath the button as the fallback and is not replaced.

## The manual flow is not verified today

Nothing checks a typed code against a real transaction. The format check
catches typos, and the unique constraint on `Order.mpesaCode` stops one code
being used on two orders. An invented code, or a real one that paid for
something else, is caught only if the owner reads her SMS carefully.

"Something else" is a live risk, because the shop still sells over WhatsApp. A
buyer can quote the code from last month's WhatsApp purchase. It is a real
transaction to the right till, and it has never been used on a site order.

Daraja offers two ways to check a code. They answer the question differently.

|                   | C2B confirmation URL                                 | Transaction Status API                                    |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| How               | Safaricom posts every payment to the till to our URL | We ask about one code; the answer arrives at a result URL |
| Checking a claim  | a lookup in our own table, instant                   | a round trip, then wait for Safaricom's callback          |
| Credentials       | OAuth only                                           | OAuth plus an **initiator** and security credential       |
| Payments it knows | only those made after the URL was registered         | any payment to our shortcode                              |
| Weak spot         | a missed notification looks like "no such payment"   | slower, and needs an operator account set up at Safaricom |

**Plan: C2B as the ledger, Transaction Status as the backstop.** Every payment
Safaricom reports goes into a `MpesaPayment` table. A claimed code is matched
against it, and so is every STK receipt. The match is not just "does this code
exist": the payment must be to our shortcode, completed after the order was
created, and for at least the order total. The last two conditions are what stop
a WhatsApp-era code from buying a site order. A code missing from the ledger is
looked up once with Transaction Status before anyone is told it is wrong,
because the missing entry may be a dropped notification and not a false claim.

A code that passes can confirm the order automatically. A code that fails does
not reject automatically. It goes to the owner with the reason attached, because
a false rejection means refusing a buyer who has actually paid.

Two cautions:

- **Buyers' phone numbers may be masked or hashed** in C2B notifications and
  Transaction Status results. Match on code, amount and time, not phone.
- **Transaction Status is asynchronous.** The HTTP response only acknowledges
  the request. The answer comes to a `ResultURL`, which needs the same
  treatment as the STK callback: a secret path, idempotency and fast 200s.

## Build against the sandbox first

Sandbox and production are the same code. The difference is a base URL and four
credentials, so everything is built and tested against Safaricom's sandbox, and
going live means changing environment variables, not code.

| Variable                | Sandbox                                   | Production                           |
| ----------------------- | ----------------------------------------- | ------------------------------------ |
| `MPESA_ENV`             | `sandbox` (`sandbox.safaricom.co.ke`)     | `production` (`api.safaricom.co.ke`) |
| `MPESA_CONSUMER_KEY`    | from our app on developer.safaricom.co.ke | from the approved live app           |
| `MPESA_CONSUMER_SECRET` | as above                                  | as above                             |
| `MPESA_SHORTCODE`       | `174379`, Safaricom's shared test paybill | the shop's till or paybill           |
| `MPESA_PASSKEY`         | Safaricom's public test passkey           | issued at go-live                    |
| `MPESA_CALLBACK_SECRET` | any random string                         | a different random string            |

The passkey is a secret, so it lives in the environment, not in `ShopSettings`.
The shortcode in the environment must agree with `ShopSettings.tillNumber`, and
the client should refuse to start if they differ: a mismatch is how money
reaches the wrong account.

### What the sandbox does and does not prove

The same: endpoints, request and response shapes, the callback payload, result
codes (including a cancelled or timed-out prompt), and STK Query.

The prompt usually arrives on the real Safaricom number it is sent to, and
developers widely report that no money is taken. Keep test amounts at KES 1
regardless.

Different:

- **It is less reliable than production.** Prompts sometimes do not arrive,
  callbacks can be slow or missing, and it has outages. This is a reason to
  build reconciliation early, not to ignore failures seen there.
- **It only exercises paybill payments.** `174379` is a paybill
  (`CustomerPayBillOnline`). A till uses `CustomerBuyGoodsOnline`, which is first
  tested at go-live.
- Receipt numbers are fake, and every developer shares the same test shortcode.

## Sandbox credentials must never reach production

With sandbox keys, a buyer on the live site gets a real-looking prompt, enters
their PIN, and the callback reports success. The shop would then mark real
garments `SOLD` without any money being paid.

Three guards, all required:

- Sandbox variables go in the local `.env` and Vercel's **Preview** environment
  only, never **Production**.
- The Daraja client refuses to run when `MPESA_ENV=sandbox` and
  `VERCEL_ENV=production`.
- In production the **Pay with M-Pesa** button is hidden until live credentials
  exist. The manual flow keeps working in the meantime.

## Callbacks are not signed

Daraja does not sign its callbacks. Anyone who learns the URL can post a
"success". So a callback is treated as a hint and never as proof on its own:

- The route carries a secret in its path: `/api/payments/callback/[secret]`.
  The name avoids "mpesa" and "safaricom", which Safaricom rejects in some
  callback URLs.
- The `CheckoutRequestID` must match a `PaymentAttempt` we created, and the
  amount must equal the order's `totalCents / 100`.
- Before selling anything, confirm the result with an STK Query call to
  Safaricom.
- Safaricom retries callbacks, so handling the same one twice must change
  nothing. The route always answers 200 quickly.

## The failure that matters most: paid, but the hold lapsed

The one-of-one rule ([one-of-one-stock.md](one-of-one-stock.md)) makes one case
dangerous. If the callback arrives after the buyer's hold has lapsed, the item
may already be held or sold by somebody else. `confirmSale` fails, but the money
has arrived.

Two things follow:

- **Extend the hold when the push is sent**, so it cannot lapse while the buyer
  is typing their PIN. Fifteen minutes is enough to start paying but not enough
  to cover a slow callback.
- **This case must never fail silently.** The order needs a state the owner can
  see, such as "paid, needs refund", with the receipt number attached.

## Amounts are whole shillings

Daraja takes integer shillings. Prices are stored in cents
([money.ts](../src/lib/money.ts)), so the amount sent is `totalCents / 100`, and
a total that is not a multiple of 100 is an error. It is never rounded: rounding
either overcharges the buyer or undercharges the shop.

## Data model

A new `PaymentAttempt` model belongs to `Order`. One order can have several
attempts, because buyers retry after a cancelled or timed-out prompt.

| Field                      | Why                                                         |
| -------------------------- | ----------------------------------------------------------- |
| `checkoutRequestId`        | unique; how a callback finds its attempt                    |
| `merchantRequestId`        | Daraja's other identifier, kept for support queries         |
| `phone`, `amount`          | what was requested, to check the callback against           |
| `status`                   | pending, succeeded, failed, cancelled, timed out            |
| `resultCode`, `resultDesc` | Safaricom's own words, for disputes                         |
| `receipt`                  | the M-Pesa receipt number on success                        |
| `rawCallback`              | the payload as received, because disputes happen after bugs |

On success the receipt also goes into the existing `Order.mpesaCode`, so its
unique constraint still stops one receipt being used on two orders, whichever
path recorded it.

A new transition, `AWAITING_PAYMENT → CONFIRMED`, sits beside `confirmOrder`,
which today only accepts `PENDING_CONFIRMATION`.

## Phases

1. **Daraja client** in `src/lib/mpesa/`, using plain `fetch` rather than an npm
   wrapper (most are unmaintained): get an OAuth token and cache it in memory
   (tokens last about an hour), `stkPush`, `stkQuery`, the production guard, and
   the new variables in `src/lib/env.ts`.
2. **Schema:** the `PaymentAttempt` migration.
3. **Checkout UI:** the button, a "check your phone" state that polls the order,
   and the manual form underneath.
4. **Callback route**, with the checks above.
5. **Reconciliation:** a Vercel cron runs STK Query on attempts with no callback
   after a few minutes.
6. **Verifying manual claims:** register the C2B confirmation URL, add the
   `MpesaPayment` ledger, and match claimed codes and STK receipts against it,
   with Transaction Status for codes the ledger has not seen.
7. **Go-live:** live credentials, the till transaction type, and one real
   KES 1 purchase end to end.

Phase 6 does not depend on STK Push and could ship first. It closes the gap in
the flow that exists today, while STK Push only adds a new one.

## Testing

- Unit tests for the password and timestamp builder
  (`base64(shortcode + passkey + timestamp)`) and for parsing callbacks, using
  recorded sandbox payloads as fixtures.
- Integration tests that post fixture callbacks to the route against the `_test`
  database: success, wrong amount, unknown `CheckoutRequestID`, a duplicate
  callback, and a success after the hold has lapsed.
- End to end in the sandbox: callbacks need a public HTTPS URL, so use a tunnel
  (`cloudflared tunnel --url localhost:3000`) or a Vercel preview deployment.

## Open questions

- **Which payment method does the owner use?** STK Push works with a registered
  till or paybill. As far as we know it does not support Pochi la Biashara;
  confirm this on the Daraja portal. If she is on Pochi, she needs a till first.
- **Go-live approval.** Safaricom must approve the live app against the
  business's documents. That can take longer than writing the code, so it
  should start early. It does not block sandbox work.
- **An initiator for Transaction Status.** It needs an API operator created on
  the M-Pesa business portal, and that operator's password encrypted with
  Safaricom's public certificate. The owner has to create the operator herself.
  The sandbox provides a test initiator.
- **Does C2B work for the owner's account type?** Like STK Push, it needs a till
  or paybill. Confirm this alongside the Pochi question.
