# One-of-one stock

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
that demonstrates it lives in `src/lib/reservations.integration.test.ts` and is
kept deliberately — a concurrency test that passes proves nothing unless it would
fail against the bug.

## The mechanism

Every operation states its precondition inside the `WHERE` clause of a single
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

## Where this lives

|                                            |                                                |
| ------------------------------------------ | ---------------------------------------------- |
| `src/lib/reservations.ts`                  | reserve, release, extend, confirm, sweep       |
| `src/lib/reservations.integration.test.ts` | including the naive comparison                 |
| `prisma/schema.prisma`                     | `ProductStatus`, `reservedUntil`, `reservedBy` |
