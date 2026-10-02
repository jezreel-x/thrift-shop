# The Thrift Plug

An online shop for a Nairobi secondhand-clothing business that currently sells through a WhatsApp
group. Buyers browse a catalogue, filter by size, reserve an item and pay by M-Pesa; the owner runs
stock and confirms payments from an admin area.

The interesting constraint is that **thrift stock is one of one**. Every item has quantity one, so
two buyers must never be able to pay for the same jacket. That drives most of the design decisions
below.

**Live:** https://thrift-shop-pi.vercel.app ·
**Health:** [`/api/health`](https://thrift-shop-pi.vercel.app/api/health)

> **Status:** Phases 0–2 complete: catalogue, accounts, cart, checkout and manual M-Pesa confirmation
> are live. Phase 3, the admin area, is in progress: staff roles, the access guard and the admin shell
> are done.
>
> The deployed catalogue is populated with **placeholder photography**, so both the pages and
> `robots.txt` carry `noindex`. The shop's own images replace it before anything is indexed.

<!-- TODO: screenshot of the catalogue. -->

## Stack

| Concern   | Choice                                                |
| --------- | ----------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19                     |
| Language  | TypeScript, strict                                    |
| Styling   | Tailwind CSS v4                                       |
| Data      | PostgreSQL (Neon) via Prisma 7                        |
| Tests     | Vitest — unit, plus integration against real Postgres |
| Images    | Vercel Blob, resized and re-encoded on upload         |
| CI        | GitHub Actions — format, lint, typecheck, test, build |
| Hosting   | Vercel                                                |

One repository, one deployment. Next.js route handlers and server actions cover the API surface, so
there is no separate backend service to run or deploy at this size.

## Running locally

Requires Node 24+ and a PostgreSQL connection string.

```bash
git clone https://github.com/jezreel-x/thrift-shop.git
cd thrift-shop
npm install            # postinstall generates the Prisma client and installs the git hooks
cp .env.example .env   # then fill in the connection strings
npm run db:migrate     # apply migrations
npm run dev
```

The app serves on http://localhost:3000. `GET /api/health` reports whether the deployment can reach
the database, which is the quickest way to check that `DATABASE_URL` is right.

Integration tests need a throwaway Postgres, which Docker provides:

```bash
npm run db:test:up        # Postgres 18 on port 5434
npm run test:integration
```

### Scripts

| Script                     | What it does                                 |
| -------------------------- | -------------------------------------------- |
| `npm run dev`              | Development server                           |
| `npm run build`            | Production build                             |
| `npm test`                 | Run the test suite once                      |
| `npm run test:watch`       | Watch mode                                   |
| `npm run test:integration` | Integration tests against Postgres           |
| `npm run typecheck`        | Route types, then `tsc --noEmit`             |
| `npm run lint`             | ESLint                                       |
| `npm run format`           | Prettier, writing changes                    |
| `npm run db:migrate`       | Create and apply a migration, **locally**    |
| `npm run db:deploy`        | Apply pending migrations to **production**   |
| `npm run db:status`        | What production has and has not applied      |
| `npm run db:studio`        | Prisma Studio                                |
| `npm run db:test:up`       | Start the test database                      |
| `npm run seed:upload`      | Resize and upload photos, write the manifest |
| `npm run seed`             | Create products from the manifest            |

## Decisions worth explaining

**Next.js rather than a SPA plus an API.** A thrift shop has to be findable, and search engines
reward server-rendered pages. Server rendering is the whole reason for the framework choice; the
absence of a second service to deploy is a bonus at this size.

**Money is an integer number of cents, never a float.** `0.1 + 0.2 !== 0.3`, and a rounding error on
a price is a real shilling gained or lost. See [`src/lib/money.ts`](src/lib/money.ts) — parsing
rejects anything finer than a cent rather than rounding it, so a typo surfaces at the boundary
instead of becoming a wrong price in the database.

**Reservations will be taken with a conditional update, not a read-then-write.** Checking
availability and then writing it is a lost update: two requests can both read "available" before
either writes. The atomic form is a single statement whose affected-row count decides the winner —

```sql
UPDATE items SET status = 'RESERVED', reserved_until = now() + interval '15 minutes'
WHERE id = $1 AND status = 'AVAILABLE'
```

— with a scheduled sweep releasing expired reservations so an abandoned checkout does not retire an
item permanently. Measured: the naive read-then-write grants the same jacket to 20 of 20 simultaneous
buyers; this grants it to one. Written up in [docs/one-of-one-stock.md](docs/one-of-one-stock.md).

**Sessions live in the database, not in a signed token.** A JWT cannot be withdrawn once issued,
which is why systems built on them grow refresh tokens, rotation, reuse detection and revocation
lists — machinery whose purpose is to recover control the design gave away. A row can be deleted.
Passwords use argon2id at OWASP's parameters. See
[docs/authentication.md](docs/authentication.md), which also covers the three mistakes that work
perfectly in testing and are vulnerabilities in production.

**Four databases, with separate jobs.** The application reads a local Postgres in development and
Neon in production, so development cannot touch live stock or customers. Migrations are generated
against a seeded local database and reach production only through `db:deploy`. Before that
separation existed, `migrate dev` — a command that offers to reset a database it finds out of step
— was pointed at the live catalogue.

**Filters live in the URL, in a form with no client JavaScript.** `/?size=M&category=HOODIES` is a
real page — linkable, shareable over WhatsApp, surviving a refresh, and reachable by a crawler. Held
in client state, none of that would be true. The cost is an explicit Apply rather than filtering as
you tick, which on a slow connection is one round trip instead of one per checkbox. Query strings
are treated as hostile input: unrecognised values are dropped so a mangled link shows the catalogue
rather than an error, and sizes and categories are allow-listed from the schema's own enums before
reaching a SQL `IN` clause.

**Sold items stay in the catalogue**, ranked below available stock and marked as sold in their
structured data. In a shop where everything is one of one, hiding them would eventually remove most
of the catalogue from search — and a grid where things visibly sell is a more honest picture of the
business than one where stock quietly vanishes.

**Integration tests run against a real Postgres, not a mock.** What is worth testing here — filter
combinations, sort order, and in Phase 2 two checkouts racing for one garment — is Postgres
behaviour. A mock would only assert that we called Prisma. The suite truncates every table between
tests, so it refuses any database whose name does not end in `_test`.

**Migrations are developed locally and deployed automatically.** `prisma migrate
dev` offers to reset a database it finds out of step — reasonable against a
scratch database, catastrophic against a live catalogue — so it is pointed at a
local Postgres and reaching production takes a deliberate `db:deploy`, which runs
`migrate deploy` and has no power to reset or prompt. The local database used for
this is seeded rather than empty, because an empty one is exactly where a bad
migration looks fine: adding a `NOT NULL` column succeeds against no rows and
fails against real ones. Vercel applies pending migrations during its build, so a
deployment can never ship code expecting a column the database does not have.

**An applied migration is immutable.** Its file is fingerprinted when it runs, and
Prisma refuses all migration work if any recorded fingerprint stops matching —
because it can no longer prove the database matches the files. Explanatory
comments therefore belong in `schema.prisma`, which is meant to change, not in
the migrations, which are the log of changes already made.

**The generated Prisma client is not committed.** `npm install` regenerates it via `postinstall`, in
CI and on Vercel alike, so it can never drift from `prisma/schema.prisma`.

**Payment is confirmed manually in v1.** The buyer pays to a till and submits the M-Pesa
confirmation code; the owner approves it, which flips the item to `SOLD`. Automatic STK Push needs a
registered paybill the business does not have yet. A separate, standalone
`mpesa-daraja-reference` project covers the Daraja API properly.

## Roadmap

- **Phase 0 — Foundation.** Scaffold, Postgres, CI, deployed. ✅
- **Phase 1 — Catalogue.** Products, images, search and filters (size first), seed data. ✅
- **Phase 2 — Buying.** Auth, cart, reservation on checkout, manual M-Pesa confirmation. ✅
- **Phase 3 — Admin.** Role-based access ✅, admin shell ✅, order management ← _next_, product CRUD.
- **Phase 4 — Operations.** Notifications, reports, CSV export.

## Licence

All rights reserved. You may clone and run it locally to evaluate it; hosting it, using it for a
business, or redistributing it needs written permission. Contributions are by invitation. See
[LICENSE](LICENSE).
