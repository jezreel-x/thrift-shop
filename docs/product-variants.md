# Product variants and stock

**Status:** proposed — awaiting approval before any code.

This replaces the earlier version of this document, which decided _not_ to build
variants. Its reasoning was sound at the time: variants would have meant guessing
at questions the business had not answered — do variants share photos, do sizes
share a price, is colour a variant or a separate product — and "guessing wrong
costs more than migrating later". Those questions now have answers. Visiting
Nairobi mall and CBD clothing shops showed the stock is one style in many sizes
and colours ("Cargo Pants, KSh 1,400, in khaki, black and olive, waist 30–38"),
and the decisions below were made with that in front of us — and with an eye on
shops that sell shoes, jewellery or perfume.

Related: [one-of-one-stock.md](one-of-one-stock.md), whose central guarantee —
two buyers can never both get the last one — carries over intact.

## Decisions

| Question                 | Decision                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What can a buyer choose? | **Up to two options per product, named per category.** Option 1 is the _look_ (Colour, Metal) and gets swatches and its own photos; option 2 is the _fit or amount_ (Size, Waist, Ring size, Volume) and gets buttons. Either may be absent. |
| Photos                   | **Per option-1 value**, Nike-style: choosing Khaki or Gold swaps the photos. Photos tied to no value are shared.                                                                                                                             |
| Price                    | **Per variant**, defaulting to the product's price. The admin sets it at three levels: base, per option value (every 36 costs KSh 1,600; every Gold ring KSh 3,000), or per cell. The most specific wins.                                    |
| Quantity                 | **Up to the units free right now, and never more than 5 per line.**                                                                                                                                                                          |
| "Only N left"            | **Shown at 3 or fewer.**                                                                                                                                                                                                                     |
| Option-1 names           | **Free text chosen by the owner**, with a colour dot they pick. Shops name colours their own way.                                                                                                                                            |
| Categories               | **Data the owner manages, not a fixed list in the database schema.** A category carries its option names, its size list, and whether Condition and Fit apply.                                                                                |

## The pieces

```
Category        a template:   "Sneakers → Option 1: Colour · Option 2: EU size (39–46)"
   └ Product    one thing for sale:   "Air Max 90, KSh 6,500"
       └ Option values   what it comes in:   White, Black · 41, 42, 43
           └ Variant     one combination, with stock and maybe a price:   White · 42 → 3
```

The same machinery covers every kind of shop:

| Product                    | Category options  | Variants                              |
| -------------------------- | ----------------- | ------------------------------------- |
| Cargo Pants (mall shop)    | Colour × Waist    | Khaki 30, Khaki 32 … — 14 in all      |
| Red plaid flannel (thrift) | Size only         | S → stock 1 — one variant, no picker  |
| Air Max 90                 | Colour × EU size  | White 42 … ; size 45 at KSh 7,000     |
| Twist Band Ring            | Metal × Ring size | Gold 7 … ; every Gold at KSh 3,000    |
| Hoop Earrings              | Metal only        | Gold → 4, Silver → 6                  |
| Oud Wood                   | Volume only       | 50 ml (KSh 4,500), 100 ml (KSh 7,800) |

Nearly everything a small shop sells is _looks × fit_. A third choice is rare
("Gold, size 7, engraved?"); it can be a separate product, and the model is
built so that an option 3 would be an addition, not a rewrite.

## What the buyer sees

```
[ photos for the chosen option-1 value ]

Cargo Pants                                  KSh 1,600   ← the chosen variant's price
Colour: Black     (○Khaki) (●Black) (○Olive)              ← option 1: swatches
Waist             [30] [32] [34] [36] [3̶8̶]               ← option 2: buttons; sold out crossed
Only 1 left in 36
[ − ]  1  [ + ]     [ Add to cart ]                       ← + stops at what is free, max 5
```

- A value that has run out stays visible, crossed out — it exists, it is gone.
- Catalogue cards show **From KSh 1,400** when prices differ, and **SOLD OUT**
  when every variant is at zero.
- On a card: a product with choices shows **Choose options**, which opens the
  product page. A product with exactly one variant and more than one free shows
  **Add to cart**, which becomes a **− n +** stepper.
- Cart and order lines read _"Cargo Pants · Black · 36 · ×1 · KSh 1,600"_.
- A thrift item — one variant, stock 1 — has no picker and no stepper, and looks
  exactly as it does today.

**Filters come from the category.** Browsing Pants offers Waist; browsing Rings
offers Metal and Ring size; across all products, only Price, Category, and Size
where categories share a size list. A size filter means _in stock in that size,
in any colour_. The price filter matches a product if any in-stock variant is in
range; sorting by price uses the lowest in-stock price — the card's "From".

**The cart reserves nothing**, as now. Every time it is shown, each line is
checked against what is free; a line whose stock has fallen says so — _"Only 1
left. Reduced from 2 to 1."_ — and its stepper stops at the new limit. The − and

- buttons are small forms, so they work without JavaScript.

## What the owner sees

A grid per product, option-1 values down and option-2 values across, with the
three price levels:

```
Cargo Pants — base price KSh 1,400
             30     32     34     36     38
Khaki         3      2      5      0      1
Black         4      4      2      1      0
Olive         –      1      3      2      2       – = not made: no variant
Price       1,400  1,400  1,400  1,600  1,600     ← per waist, every colour
```

Confirming a sale lowers a count. "Sold elsewhere" lowers it by one. A restock or
a recount sets it. Every change goes in a ledger with who made it and why.

## The model

```prisma
model Category {               // replaces the Category enum
  id            String   @id
  slug          String   @unique      // "pants" — URLs and filters
  name          String               // "Pants"
  position      Int
  option1Name   String?              // "Colour" | "Metal" | null
  option2Name   String?              // "Waist" | "Ring size" | "Volume" | null
  option2Values String[]             // ["28","30",...,"40"] — offered in this order
  showCondition Boolean              // thrift and second-hand: yes; new stock: no
  showFit       Boolean              // Men's / Women's / Unisex: clothing yes, perfume no
}

model ProductSwatch {           // option-1 values: Khaki, Black, Gold
  id        String  @id
  productId String
  name      String               // as the owner writes it
  hex       String?              // the swatch dot
  position  Int
  @@unique([productId, name])
}

model ProductVariant {          // what is actually bought
  id         String  @id
  productId  String
  swatchId   String?             // null: the product has no option 1
  option2    String?             // "32" — null: no option 2
  stock      Int                 // units in the shop and not yet sold
  priceCents Int?                // null: the product's price
  // unique (productId, swatchId, option2) NULLS NOT DISTINCT — Postgres 15+
  // (18 locally and on Neon), so a product without options still gets exactly
  // one row. Raw SQL in the migration; Prisma cannot express it.
}

model StockHold {               // replaces Product.reservedBy / reservedUntil
  id        String   @id
  variantId String
  holder    String               // user id, as today
  quantity  Int
  expiresAt DateTime             // 15 minutes; 24 hours once payment is claimed
  @@unique([variantId, holder])  // one hold per buyer per variant; checking out again extends it
  @@index([variantId, expiresAt])
}

model StockMovement {           // the ledger: every change to `stock`
  id        String   @id
  variantId String
  change    Int                  // -1 sold, +5 restock, -1 sold elsewhere
  reason    String               // "sale confirmed", "sold elsewhere", "restock", "count corrected"
  orderId   String?
  actorId   String?              // who, when a person did it
  createdAt DateTime
}
```

Changes to existing models:

- `Product` points at a `Category` row; `condition` and `gender` become optional
  (shown only where the category says so). `priceCents` stays as the base price.
- `ProductImage.swatchId` (optional) — which option-1 value a photo shows.
- `CartItem` points at a **variant** and gains `quantity`.
- `OrderItem` points at a variant, gains `quantity`, and snapshots the option
  values alongside the title and price it already snapshots — so an old order
  still reads correctly after a product is renamed or repriced.
- Dropped in the contract step, once nothing read them: `Product.size`,
  `status`, `reservedBy`, `reservedUntil`, the `Category` and `ProductStatus`
  enums, and `ProductStatusHistory` (the stock ledger, `StockMovement`, took
  over). `CartItem.productId` was kept: merging a guest's cart into their
  account still reads it, and dropping it would mean reworking code that works
  for no gain.

**The per-value prices are an admin shortcut, not a table.** Setting "every 36
costs KSh 1,600" writes that price onto each 36 variant. Checkout, the cart and
orders only ever ask one question — what does this variant cost? — and the answer
is the variant's price or, failing that, the product's.

## Reserving: the one-of-one guarantee, generalised

What a buyer can take is **free = stock − units held by other buyers in holds that
have not expired**. Reserving locks the variant's row, works that out, and creates
or extends the buyer's hold in the same transaction:

```sql
BEGIN;
SELECT stock FROM "ProductVariant" WHERE id = $1 FOR UPDATE;    -- one reserver at a time, per variant
SELECT COALESCE(SUM(quantity), 0) FROM "StockHold"
  WHERE "variantId" = $1 AND holder <> $2 AND "expiresAt" > now();
-- hold min(requested, free); if free is 0, refuse
COMMIT;
```

If a buyer asks for 3 and only 2 are free, checkout holds 2 and says so before
anything is paid — the same "proceed with what you can" rule checkout already
uses when one item in a cart has sold.

Why holds are counted rather than subtracted from `stock`:

- **Expiry stays a matter of time, not of a job running.** An expired hold simply
  stops counting. If holds lowered `stock`, every abandoned checkout would keep
  units off sale until a sweep put them back — and the sweep is not even
  scheduled today. The current rule, _the sweep is housekeeping, not
  correctness_, survives unchanged.
- **`stock` means one thing:** units in the shop and not yet sold. It moves only
  when a sale is confirmed or the owner changes it, and every move is in the
  ledger.
- The row lock lasts two short statements and only blocks other buyers of **the
  same variant**. Buyers of different sizes never wait on each other.

The lifecycle maps one-for-one onto today's:

| Today (one product)                     | With variants                                                            |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `reserveProduct` — AVAILABLE → RESERVED | create or extend the buyer's hold, if enough is free                     |
| `holdForPaymentReview` — extend to 24 h | extend the hold to 24 h                                                  |
| `confirmSaleIn` — RESERVED → SOLD       | `stock -= quantity`, delete the hold, ledger entry; requires a live hold |
| `releaseHoldIn` — back to AVAILABLE     | delete this buyer's hold — holder-scoped, as fixed in PR #12             |
| sweep releases lapsed holds             | sweep deletes expired hold rows — tidiness only                          |

The concurrency test carries over and grows: twenty buyers against a stock of 1
must produce exactly one winner; against a stock of 3, exactly three units held,
however the requests interleave.

**Sold elsewhere** lowers stock by one only if a unit is free of holds. If every
unit is held by an online buyer, the admin says so rather than overselling: the
owner decides which buyer to disappoint, not the database.

## Migration — expand, then contract

Production has no real orders yet. This is still done the way it would have to be
with a year of them, because that is the habit worth having.

1. **Expand** (migrations with backfill in SQL):
   - create the new tables and nullable columns;
   - one `Category` row per existing category: option 2 "Size" with the letter
     sizes, no option 1, Condition and Fit shown — so the shop behaves exactly as
     now — and every product pointed at its row;
   - one variant per product: its `size`, no swatch, `stock` 0 if SOLD and 1
     otherwise, no price override;
   - a `StockHold` for every live reservation (`reservedBy`, `reservedUntil`);
   - every `CartItem` and `OrderItem` pointed at its product's variant, quantity 1;
   - one `StockMovement` per variant recording the opening stock.
2. **Switch the code** to the new model in the same deploy. The old columns remain
   but nothing reads or writes them.
3. **Contract**, in a later PR once (2) is live: make the new foreign keys
   required and drop the old columns and the enum. Dropping a column the running
   code still reads is the failure expand/contract exists to prevent; by step 3
   nothing does.

   _Done 8 October 2026_, in `20261008090000_contract_one_of_one`. Production
   was checked first: every product had a category row and every cart and order
   line a variant, so the `NOT NULL`s could not fail. The 41 rows of
   `ProductStatusHistory`, all from pre-launch testing, were exported before the
   table was dropped.

## Order of work

| PR  | What                                                                                                                                                                                                                                             | Visible change                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | **Variants core.** Expand migration and backfill for variants, holds and the ledger; reservations, cart, checkout, orders and the order queue on variants, with quantities; concurrency tests for stock 1 and stock N                            | **None** — the thrift shop looks and behaves the same |
| 2   | **Categories as data.** The table, the backfill from the enum, option names and size lists per category, Condition and Fit optional                                                                                                              | **None**                                              |
| 3   | **Storefront.** Swatches and per-swatch photos, option-2 buttons with sold-out values, prices that follow the choice, "From KSh", "Only N left", quantity steppers on the product page, cart and single-variant cards, filters from the category | Product page, catalogue, cart                         |
| 4   | **Admin products.** Categories screen; product form with the variant grid and the three price levels; browser-resized uploads tagged by swatch; sold elsewhere, holds for WhatsApp buyers, share to WhatsApp; the stock ledger                   | Admin → Products                                      |
| 5   | **Contract migration.** ✅                                                                                                                                                                                                                       | None                                                  |

PRs 1 and 2 changing nothing visible is deliberate: they prove the new model
carries today's shop exactly before anything is built on it.

## Still open

- **Hiding sold-out products.** The Thrift Plug shows sold pieces, which suits
  thrift; a mall shop may prefer them hidden. A per-shop setting, later.
- **The quantity cap.** 5 per line suits retail. It becomes a per-shop setting if
  a shop sells in bulk.
- **Multi-tenancy** stays out of scope (second paying client). Nothing here makes
  it harder: categories becoming data is, if anything, a step towards it.
