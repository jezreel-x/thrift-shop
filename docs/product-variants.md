# Product variants: why not, and what it would take

**Status:** not building them. Recorded because the question recurs, and the
answer is a decision rather than an oversight.

Related: [one-of-one-stock.md](one-of-one-stock.md), which describes the model
this would replace.

## The question

Thrifting produces distinct garments — one hoodie, one row. Buying in bulk
produces thirty identical hoodies across S, M and L.

If the shop moves from the first to the second, should one `Product` hold many
`Variant` rows, each a size with a quantity, as ordinary e-commerce does?

## Why not now

### It would delete the problem this project exists to solve

With a quantity column, two buyers reaching checkout together stops being a
conflict and becomes arithmetic:

```sql
UPDATE variant SET quantity = quantity - 1 WHERE id = $1 AND quantity > 0
```

Both usually succeed. When they do not, one sees "out of stock" — routine, and
handled by every e-commerce framework already written.

The conditional update, the holder, the fifteen-minute window, the sweep and the
test that measures twenty simultaneous buyers all exist because **exactly one
buyer can win here**. That is the business, not an implementation detail.

### It would mean guessing at unanswered questions

The schema is the easy part. These are not, and bulk stock has not yet said:

| Question                          | Why it splits                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Do variants share photographs?    | A bale of black hoodies: one set. A red and a blue of the same style: is colour a variant, or a separate product? |
| Same price across sizes?          | Usually. Not always.                                                                                              |
| Same condition?                   | Thrift grades each garment. Bulk stock is uniform. Different column, different table.                             |
| Thirty items, or quantity thirty? | Thirty from a supplier is a quantity. Thirty thrifted is thirty garments with thirty different amounts of wear.   |

Guessing wrong costs more than migrating later, because a phase of features gets
written against the wrong abstraction.

### A `quantity` column "just in case" is the worst option

Either the reservation logic honours it — which is variants, with extra steps —
or it does not, and the schema asserts something the code ignores. A field that
lies is worse than a field that is absent.

## What the migration would involve

1. A `Variant` table: `productId`, `size`, `quantity`.
2. Backfill one variant per product, quantity 1, taking `size` from the product.
3. Move `reservedUntil` and `reservedBy` from `Product` to `Variant`.
4. Repoint `CartItem` and `OrderItem` from `productId` to `variantId`.
5. Update the catalogue queries to aggregate variants.

Two to three days — about what building it now would cost, but spent with the
answers known.

## Why the seams are already in the right place

Checkout calls `reserveProduct(id, holder)` rather than inlining the SQL, and
`getCartContents` returns shaped lines rather than raw rows. Those functions'
insides would change; most of their callers would not.

## The one thing that genuinely gets harder with time

Once orders exist, historical ones reference products while new ones reference
variants. `OrderItem` stores a price snapshot precisely so that it is a record of
what was sold rather than a live pointer, which keeps an old row valid — but the
split is real, and it is the strongest argument for deciding this before the shop
has a year of orders behind it.

The decision, for now, is still no.
