# The Thrift Plug

An online shop for Nairobi clothing sellers who today sell through Instagram, TikTok and WhatsApp
with no website: a Westlands thrift seller with one of everything, or a mall shop with one style of
cargo pants in five colours and every waist size. Buyers browse and filter by size, pick a colour and
size, reserve at checkout and pay by M-Pesa. The owner and their staff run stock, photos, holds and
payment checks from an admin area.

The hard problem is **never selling the same unit twice**. The last pair in a size can be in two
checkouts, a WhatsApp chat and an over-the-counter sale at the same moment, and exactly one of them
may get it. Most of the design below follows from that.

**Live:** https://thrift-shop-pi.vercel.app ·
**Health:** [`/api/health`](https://thrift-shop-pi.vercel.app/api/health)

> **Status:** catalogue, accounts, cart, checkout with reservation and manual M-Pesa confirmation are
> live, and so is most of the admin area: staff roles and permissions, the order queue, payment
> settings, and product management (stock grid, photos, sold elsewhere, WhatsApp holds). Delivery at
> checkout, demo mode and fulfilment tracking are next — see the [roadmap](#roadmap).
>
> The deployed catalogue uses **placeholder photography**, so the pages and `robots.txt` carry
> `noindex`. Real photos replace it before anything is indexed.

## What it does

**For buyers**

- A catalogue filtered by size first, then category, price, condition and fit, all held in the URL
  so a filtered view can be shared on WhatsApp.
- Products with colour swatches (each with its own photos) and size buttons; sold-out sizes stay
  visible, crossed out. Prices can differ by size or colour; cards show "From KSh 1,400".
- A cart that promises nothing, and a checkout that reserves for 15 minutes, tells the buyer exactly
  what it could hold, and shows the name M-Pesa will display so a copycat page's till is caught
  before the PIN.
- Order tracking while the shop checks the payment, and **Order on WhatsApp** for buyers who prefer
  to ask in a chat.

**For the shop**

- **Order queue.** Find each claimed payment in your own M-Pesa records, then confirm or reject it.
  Each decision is one transaction: every item sold, or none.
- **Products.** A colour × size stock grid with prices at three levels (base, a whole size or colour,
  one cell); photos shrunk in the browser and tagged by colour.
- **Stock page.** Sold elsewhere, Hold for a WhatsApp buyer (then sold or released), Share to
  WhatsApp, and the stock history: every change, who made it and why.
- **Staff permissions** the owner assigns by role, and an audit log of every change that matters.

## Stack

| Concern   | Choice                                                       |
| --------- | ------------------------------------------------------------ |
| Framework | Next.js 16 (App Router, Server Components, Server Actions)   |
| Language  | TypeScript, strict                                           |
| Styling   | Tailwind CSS v4, light and dark themes                       |
| Data      | PostgreSQL (Neon in production) via Prisma 7                 |
| Images    | Vercel Blob; resized in the browser, named by content hash   |
| Tests     | Vitest: unit, and integration against a real Postgres 18     |
| Checks    | Format, lint, typecheck, unit, integration and build on push |
| Hosting   | Vercel                                                       |

One repository, one deployment. Server Components, Server Actions and two small route handlers cover the
whole API surface, so there is no separate backend service to run.

## Running locally

Requires Node 24+, Docker, and a PostgreSQL connection string.

```bash
git clone https://github.com/jezreel-x/thrift-shop.git
cd thrift-shop
npm install            # generates the Prisma client and installs the git hooks
cp .env.example .env   # then fill in the connection strings
npm run db:migrate     # apply migrations to your local database
npm run seed           # products from prisma/seed-manifest.json
npm run dev
```

The app serves on http://localhost:3000. To use the admin area, sign up, then make that account the
owner:

```bash
npm run staff:grant-owner -- you@example.com
```

Integration tests need a throwaway Postgres, which Docker provides:

```bash
npm run db:test:up        # Postgres 18 on port 5434
npm run test:integration
```

### Scripts

| Script                                 | What it does                                  |
| -------------------------------------- | --------------------------------------------- |
| `npm run dev`                          | Development server                            |
| `npm run build`                        | Production build (applies pending migrations) |
| `npm test`                             | Unit tests                                    |
| `npm run test:integration`             | Integration tests against Postgres            |
| `npm run typecheck`                    | Route types, then `tsc --noEmit`              |
| `npm run lint` / `npm run format`      | ESLint / Prettier                             |
| `npm run db:migrate`                   | Create and apply a migration, **locally**     |
| `npm run db:deploy`                    | Apply pending migrations to **production**    |
| `npm run db:status`                    | What production has and has not applied       |
| `npm run db:test:up`                   | Start the test database                       |
| `npm run seed:upload` / `npm run seed` | Upload seed photos / create seed products     |
| `npm run staff:grant-owner -- <email>` | Make an account the owner (`:production` too) |

## Decisions worth explaining

### Selling the last unit once

A reservation is taken by **locking the variant's row**, then counting what other buyers hold, in one
transaction:

```sql
SELECT stock FROM "ProductVariant" WHERE id = $1 FOR UPDATE;
-- free = stock − units in other buyers' unexpired holds
```

A second buyer for the same size waits on the lock and counts after the first has committed. Buyers of
different variants never wait on each other. Holds are **counted, never subtracted**: what can be sold
is `stock − unexpired holds`, worked out at that moment, so a lapsed hold simply stops counting. No
background job has to run for the shop to be correct.

Everything that touches stock takes the same lock: checkout, confirming a payment, the owner saving
the stock grid, "Sold elsewhere", and a WhatsApp hold. So "Sold elsewhere" can refuse a unit that is
in someone's checkout, and a WhatsApp hold makes the website refuse it. Measured with the naive
read-then-write, 20 simultaneous buyers all got the one jacket; with the lock, one did. See
[docs/one-of-one-stock.md](docs/one-of-one-stock.md) and
[docs/product-variants.md](docs/product-variants.md).

### The owner's edits never undo a sale

The stock grid is edited while sales keep happening. Each cell sends the count it was showing; on
save:

- a count the owner didn't touch is not written, so a sale since the form opened stays sold;
- a count the owner changed that also changed underneath them is refused, with the new number;
- nothing goes below what buyers hold.

That is optimistic concurrency, with the shown count playing the role of a version number, inside
the same row lock as above. Every stock change is a ledger row with who made it and why.

### Permissions as data, enforced everywhere

Code asks "may this person confirm payments?", never "is this a manager?". Roles are bundles of
permissions the owner chooses; a super-admin role gets every permission, including ones added later.
Every admin page and Server Action calls `requirePermission`, because a Server Action is a public POST
endpoint whatever the UI hides, and a **static test fails the build** if one forgets. Non-staff get
a 404, not a 403, and page titles are withheld from them too.

### Changing the data model without downtime

Moving from one-of-one items to colour × size variants, and from a fixed category enum to categories
the owner manages, followed **expand → backfill → switch → contract**: add the new tables and
columns, fill them from the old ones, move the code over, and only then drop the old columns. Every
step deploys on its own, and production is checked with row counts after each. The contract step is
still to come.

Migrations are developed against a seeded local database, never production: an empty database is
where a bad migration looks fine. Vercel applies pending migrations during its build, so code can
never ship ahead of its columns. A migration is never edited once it has run; Prisma fingerprints
each one.

### Photos go straight to storage, and are checked

A phone photo is shrunk in the browser (2000px, WebP) before it uses mobile data, hashed, and named
`products/<sha-256>.webp`. The server hands out a short-lived token for that one name, the browser
uploads straight to Vercel Blob, and attaching the photo **downloads it and checks the hash** — the
browser's claim is verified, not trusted. The same photo twice is one photo.

### Money is an integer number of cents

`0.1 + 0.2 !== 0.3`. Prices are integer cents throughout, and parsing rejects anything finer than a
cent rather than rounding it, so a typo fails at the form instead of becoming a wrong price. See
[`src/lib/money.ts`](src/lib/money.ts).

### Payment is confirmed by hand, and that is designed for

The buyer pays to a till and submits the M-Pesa code. The code is unique across all orders, so it
cannot be spent twice. Staff confirm it **against their own M-Pesa records, never a screenshot**,
and the hold is extended while they do. Checkout tells the buyer the name M-Pesa will show and to
stop if it shows another. Automatic confirmation through Daraja is designed in
[docs/mpesa-stk-push.md](docs/mpesa-stk-push.md) and needs a real paybill.

### Sessions are rows, not signed tokens

A JWT cannot be withdrawn once issued; a row can be deleted. Sessions are database rows holding a
hash of the cookie's token, and passwords use argon2id at OWASP's parameters. See
[docs/authentication.md](docs/authentication.md), including three mistakes that work perfectly in
testing and are vulnerabilities in production.

### The URL is the state, and it works without JavaScript

Filters, the variant picker (`?option1=khaki&option2=32`), the order queue's tabs and the admin's
stock buttons are links and plain forms. A filtered view survives a refresh and can be shared, and
the core flows work before any script loads. Query strings are treated as hostile: unknown values
are dropped, and sizes and categories are allow-listed before reaching SQL.

### Tests run against a real Postgres

What matters here — two checkouts racing for one unit, a sale landing mid-edit, a hold expiring —
is Postgres behaviour, which a mock cannot show. The suite truncates every table between tests and
refuses any database whose name does not end in `_test`.

### Checks run on every push

GitHub Actions is unavailable on this account, so a pre-push hook runs the same gates as the CI
workflow: format, lint, typecheck, unit and integration tests. The workflow stays in the repository
for when Actions is available.

## Roadmap

- **Phase 0 — Foundation.** Scaffold, Postgres, CI, deployed. ✅
- **Phase 1 — Catalogue.** Products, images, search and filters (size first), seed data. ✅
- **Phase 2 — Buying.** Accounts, cart, reservation at checkout, manual M-Pesa confirmation. ✅
- **Phase 3 — Admin.**
  - Staff roles and permissions, access guard, admin shell, themes ✅
  - Order queue, payment settings, order tracking ✅
  - Colour × size variants, categories as data, the storefront for them ✅
  - "You may also like" and Order on WhatsApp ✅
  - Product management: stock grid, photos, stock page ✅
  - Delivery at checkout: pickup, or delivery to an area for its fee ← _next_
  - Demo mode, then the contract migration
  - Fulfilment: order status to the door, a delivery code, pay on delivery
  - Customer register, and a staff and roles screen
- **Phase 4 — Operations.** Notifications, reports, CSV export.

## Licence

All rights reserved. You may clone and run it locally to evaluate it; hosting it, using it for a
business, or redistributing it needs written permission. Contributions are by invitation. See
[LICENSE](LICENSE).
