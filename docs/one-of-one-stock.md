# One-of-one stock

> **Since variants (October 2026):** a product now has variants with stock counts,
> and a thrift item is the special case with one variant and a stock of 1. The
> guarantee below is unchanged; the mechanism generalised from a status on the
> product to a locked count on the variant. See "The mechanism" and
> [product-variants.md](product-variants.md). The reasoning in this document
> about why the race matters, holders, the two windows, the sweep and carts all
> still holds.

Every garment in this shop exists exactly once. That single fact drives more of
the design than anything else, and it makes one problem genuinely hard: two
buyers reaching checkout at the same moment.

## Why this is not an inventory problem

In an ordinary shop, concurrent checkouts are arithmetic. Nike has 4,200 XL
hoodies; two buyers check out at 14:00:05; stock goes to 4,198. Both are right,
nobody is disappointed, and a count that is briefly wrong self-corrects.

Here there is **one** Buttoned hoodie. If both buyers succeed, one of them has
paid KSh 2,300 for a garment that does not exist. That is not a counting error to
reconcile later — it is a refund, an apology, and a customer who does not come
back. It has to be impossible, not unlikely.

## The bug this avoids

The obvious implementation is a lost update:

```ts
const item = await find(id); // both read AVAILABLE
if (item.status === "AVAILABLE") {
  // both pass
  await update(id, "RESERVED"); // both write; both believe they won
}
```

Between the read and the write there is a window. Under any real concurrency,
every caller passes the check before any of them writes.

This is not a rare race that needs hammering to reproduce. Measured against this
schema with twenty simultaneous buyers, **all twenty won**, repeatably. The test
that demonstrates it lives in `src/lib/shop/reservations.integration.test.ts` and is
kept deliberately — a concurrency test that passes proves nothing unless it would
fail against the bug.

## The mechanism

**Now:** reserving locks the variant's row (`SELECT … FOR UPDATE`), counts the
units other buyers hold in unexpired holds, and creates or extends this buyer's
hold only if enough are free, all in one transaction. A second buyer for the
same variant waits on the lock and counts after the first has committed. Holds
are counted against stock, never subtracted from it, so a lapsed hold simply
stops counting. The concurrency tests cover a stock of 1 (one winner of twenty)
and a stock of 3 (exactly three units held, however requests interleave).

**Originally,** with one-of-one stock and no variants, every operation stated its precondition inside the `WHERE` clause of a single
`UPDATE`, and reads the affected-row count to discover whether it won.

```sql
UPDATE "Product"
   SET status = 'RESERVED', "reservedUntil" = now() + interval '15 minutes',
       "reservedBy" = $2
 WHERE id = $1
   AND "deletedAt" IS NULL
   AND (status = 'AVAILABLE'
        OR (status = 'RESERVED' AND "reservedUntil" < now()))
```

Postgres locks the row for whichever transaction arrives first. The second waits
— for microseconds, not for the length of the reservation — and when the first
commits, **re-evaluates its `WHERE` against the new row**. Status is now
`RESERVED` with an expiry in the future, so nothing matches and the affected-row
count is zero.

One row affected means you won. Zero means somebody else did.

There is no window between checking and writing because they are the same
statement, and no lock is held across application logic.

## Holders

`reservedBy` carries whoever holds the reservation. Without it a hold is
anonymous and any second visitor could complete checkout against it — the entire
point being that this item is promised to one person.

Every operation is scoped to the holder. You cannot release, extend or complete
somebody else's reservation.

## Two windows, one mechanism

A hold covers two quite different waits:

| Phase                    | Waiting for                       | Window     |
| ------------------------ | --------------------------------- | ---------- |
| Entering details, paying | the buyer                         | 15 minutes |
| Confirming the payment   | a person reading their M-Pesa SMS | 24 hours   |

Fifteen minutes is right for the first and badly wrong for the second. In v1
confirmation is manual, so a buyer can pay at 14:09, have their hold lapse at
14:15, and lose the item to somebody else while their money is already gone.

Submitting a payment claim therefore **converts** the hold rather than ending it:
same mechanism, longer window. Deliberately not a second status, so the sweep,
the catalogue query and checkout all keep working unchanged.

## The deadline is set once

Reserving again while a hold is live keeps its deadline. A hold due at 17:30
is still due at 17:30 after a refresh at 17:27, after coming back from the
order page, or after changing quantities. If every visit to checkout bought a
fresh fifteen minutes, refreshing would keep the last unit off sale for as
long as somebody cared to, without paying. Once a hold has run out, checking
out again starts a new window, but only if the units are still free, and
anyone else has had their chance in between.

Only real progress towards paying extends a hold: sending an M-Pesa code (24
hours, below), and later a payment prompt being sent.

## When a hold runs out before payment

The hold protects the units; the order needs its own answer. An unpaid order
whose holds have run out can no longer be paid for, and everything says so:

- **Checkout** shows when the hold ends ("Held for you until 16:24"). A tab
  left open past that swaps the till and the code form for "Your hold ran out",
  so nobody sends money from a stale page.
- **The buyer's order page** says the pieces went back on sale and nothing was
  charged, and offers **Check out again**.
- **Sending a code** is refused unless every line is still held. It checks the
  whole order before extending anything.
- **Checking out again** reuses the order only while it is still held (a
  refresh, or coming back within the fifteen minutes). After that the old order
  is closed as `CANCELLED` and a new one starts, with a new reference and
  today's date.
- **Staff** see "Hold ran out" in the queue instead of "Awaiting payment".
- **The daily housekeeping** closes unpaid orders whose holds ran out over a
  day ago, so the Awaiting payment tab only lists orders that can still be paid.

Whether an order is still held is read from the holds themselves
(`heldUntil` in `src/lib/shop/orders.ts`), never worked out from the order's
dates, so it cannot disagree with what checkout and the stock count see. A
payment that does arrive late, which only happens once a code has been sent or
an automatic payment has started, is settled by the rule in
[payments.md](payments.md).

## The sweep is housekeeping, not correctness

`releaseExpiredReservations()` returns lapsed holds to the catalogue. It is worth
being precise about what it is for.

An expired hold already counts as available — that is the second branch of the
`OR` above — so a buyer never has to wait for the sweep to run. If the sweep
stopped running tomorrow, **nobody would ever be sold the wrong thing.** The shop
would merely display stale "Reserved" badges.

What the sweep prevents is the opposite failure: without it, one abandoned
checkout removes an item from the shop **permanently**, and silently. The owner
would notice only by never making the sale.

## Carts do not reserve

A cart is a list of intentions. A reservation is a promise. Only the promise is
exclusive, and it is granted at the last possible moment for the shortest
possible time.

If adding to a cart reserved stock, anyone could freeze the entire catalogue by
browsing — no attack required. Ten shoppers with five items each would empty the
shop while selling nothing. Two carts may contain the same jacket; whoever
reaches checkout first gets it, and the other is told at checkout rather than
after paying.

## Bulk stock

It came: shops visited in Nairobi sell one style in many sizes and colours. The
problem did not become arithmetic after all — "the last unit of Khaki 32" is
exactly the one-of-one race, so the mechanism generalised rather than went away.
The design is in [product-variants.md](product-variants.md).

## Where this lives

|                                                 |                                                |
| ----------------------------------------------- | ---------------------------------------------- |
| `src/lib/shop/reservations.ts`                  | reserve, release, extend, confirm, sweep       |
| `src/lib/shop/availability.ts`                  | free units, per-line cap, product state        |
| `src/lib/shop/reservations.integration.test.ts` | including the naive comparison                 |
| `prisma/schema.prisma`                          | `ProductVariant`, `StockHold`, `StockMovement` |
