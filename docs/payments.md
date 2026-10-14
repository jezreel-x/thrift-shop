# Payments

> **Status:** P1 built (12 October 2026): `settlePayment` (as `settleItemsIn` in
> `src/lib/payments/settle.ts`), the `Payment` record, and Needs refund. P2
> built in the sandbox (14 October): M-Pesa prompts, "How will you pay?", and
> settling by asking Safaricom; see [mpesa-stk-push.md](mpesa-stk-push.md). P3
> is next.

Today every payment is confirmed by a person. The buyer pays the shop's till,
types the M-Pesa code into checkout, and staff find that payment in their own
M-Pesa records before the order is confirmed. It works, but a person is the
bottleneck on every sale, and a payment nobody checks in time is a buyer who
paid and may not get the item.

The plan is to let the payment confirm the order itself wherever it can, and to
keep a person only for what nothing else can verify.

## Paying is chosen before anything else happens to the order

What happens after an order (packing, delivery, the rider collecting cash)
depends on how it is being paid: already paid, or paying on delivery. So
checkout asks **"How will you pay?"** after "Pickup or delivery", and fulfilment
tracking (status to the door, the delivery code) is built on the answer.

| Option                                         | Offered when                                              |
| ---------------------------------------------- | --------------------------------------------------------- |
| **M-Pesa prompt to your phone** (STK Push)     | the shop's till or paybill has Daraja access; the default |
| **Pay our till yourself, then enter the code** | always: the fallback                                      |
| **Card or another wallet** (an aggregator)     | later, for shops that want cards                          |
| **Pay on delivery**                            | the shop turns it on and the buyer chose delivery         |

## How a payment finds its order

| Path                            | How the shop learns it was paid                           | What links it to the order                                                                                 |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **STK Push**                    | Safaricom calls our callback with the result              | We start the payment, so we store Safaricom's `CheckoutRequestID` against the order before any money moves |
| **Till or paybill, code typed** | Safaricom's C2B confirmation of every payment to the till | The typed code (a till has no account field); on a paybill, also the order reference typed as the account  |
| **Aggregator**                  | The provider's notification, then a status query          | Our order reference, sent when the payment is created                                                      |
| **Pochi la Biashara**           | A person, from their M-Pesa messages                      | The typed code. As far as we know Pochi has no Daraja API; confirm on the portal                           |

Whichever path, the M-Pesa receipt (`UJ2LQ8HPVQ`) ends up in `Order.mpesaCode`,
whose unique constraint stops one receipt paying for two orders. The order's
staff page gains a **Payment** panel: method, receipt, amount, phone, time, and
every attempt (a cancelled prompt, a timeout, the one that worked).

## One rule settles every payment

Money can arrive late on every path: a slow PIN, a reply from Safaricom that
arrives after the buyer's hold, a card payment finished after the buyer
wandered off, a manual claim nobody checked for a day. Instead of each path
deciding what "late" means, every path calls one function once a payment is
known to be good:

```
settlePayment(order, payment)
  ├─ the buyer's holds are still live      → sell the items                    → CONFIRMED
  ├─ the holds lapsed, the units are free   → hold them again and sell, at once → CONFIRMED
  └─ the holds lapsed, the units are gone   → NEEDS_REFUND: alert the owner,
                                               tell the buyer, keep the receipt
```

- It takes the variant row locks that checkout and selling take
  ([one-of-one-stock.md](one-of-one-stock.md)), so holding again can never take
  a unit somebody else is paying for.
- It is idempotent. The same receipt reported twice (Safaricom retries, a person
  double-clicks) settles once.
- It checks the amount. A payment for less than the order total doesn't confirm
  it.
- Staff's **Confirm** button calls it too, which turns today's "this hold has run
  out, this order can't be confirmed" into **confirm if still available**.

The hard decision (sell, hold again, or refund) is written and tested once. Each
new payment method is then mostly plumbing that ends in `settlePayment`.

## Order states

| State                    | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `AWAITING_PAYMENT`       | Items held; nothing paid yet                                             |
| `PENDING_CONFIRMATION`   | The buyer typed a code that nothing has verified yet                     |
| `CONFIRMED`              | Paid and sold                                                            |
| `REJECTED`               | A claim that didn't check out                                            |
| `CANCELLED`              | Abandoned                                                                |
| **`NEEDS_REFUND`** (new) | Paid, but the items were gone. The owner refunds, then marks it refunded |

`NEEDS_REFUND` gets its own tab in Orders and an honest message on the buyer's
order page, rather than an order sitting in "To confirm" forever. The refund
itself is a person sending money back; Daraja's B2C API could automate it much
later.

## The manual flow stays

It is no longer the main path, but it remains, underneath the prompt:

- prompts fail for ordinary reasons: the phone is off, the prompt times out, the
  buyer is on another network or paying from someone else's line;
- a callback can be lost, and a status query can come back unclear;
- some shops have no API access at all (Pochi la Biashara).

What shrinks is the human part. Once C2B confirmations are recorded (P3), a
typed code is checked against Safaricom's own record automatically; only codes
nothing can verify reach a person.

## Phases

Each phase ships on its own and leaves the shop working.

| Phase     | What                                                                                                                                                                                                                                                         | Needs                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **P1** ✅ | **Foundation.** "How will you pay?" at checkout (only the manual option until STK is ready); a payment record per order with its attempts; `settlePayment`, called by staff's Confirm; the `NEEDS_REFUND` state, its tab, and the buyer's message            | nothing new                   |
| **P2** ✅ | **STK Push, in the sandbox.** The Daraja client, sending the prompt, the callback (into `settlePayment`), and a cron that queries prompts with no callback after a few minutes (also into `settlePayment`). Detail in [mpesa-stk-push.md](mpesa-stk-push.md) | Daraja sandbox keys           |
| **P3**    | **Verifying manual codes.** Record Safaricom's C2B confirmations; a typed code that matches, for the right amount, settles automatically. Pochi and unmatched codes still go to staff, through the same function                                             | the C2B URL registered        |
| **P4**    | **An aggregator for cards** (Pesapal, Paystack or Flutterwave, compared when we get there). Its notification ends in `settlePayment`                                                                                                                         | a merchant account            |
| **P5**    | **Going live, per shop.** The client's own till or paybill, its live keys, and one real small purchase end to end                                                                                                                                            | the client's go-live approval |

Fulfilment tracking (status to the door, the delivery code) and pay on delivery
follow, built on the payment state these leave behind.

## Keys and environments

Sandbox keys live in `.env` locally and in Vercel's **Preview** environment
only. Production gets a shop's live keys, and the Daraja client refuses sandbox
settings in production; see "Sandbox credentials must never reach production"
in [mpesa-stk-push.md](mpesa-stk-push.md). While there is one shop, its keys are
environment variables; with several shops (multi-tenancy) they become
per-shop settings, encrypted.

## Open questions

- **Pochi la Biashara:** confirm on the Daraja portal that it has no API for
  payments. If a client is on Pochi, they stay on the manual flow or open a till.
- **Which aggregator**, if any client wants cards: fees, M-Pesa support,
  settlement time, and how notifications are verified.
- **Refunds:** manual for now. When does B2C become worth its setup (an
  initiator, a security credential, its own go-live)?
