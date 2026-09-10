# The Thrift Plug

An online shop for a Nairobi secondhand-clothing business that currently sells through a WhatsApp
group. Buyers browse a catalogue, filter by size, reserve an item and pay by M-Pesa; the owner runs
stock and confirms payments from an admin area.

The interesting constraint is that **thrift stock is one of one**. Every item has quantity one, so
two buyers must never be able to pay for the same jacket. That drives most of the design decisions
below.

**Live:** https://thrift-shop-jezreel-xs-projects.vercel.app ·
**Health:** [`/api/health`](https://thrift-shop-jezreel-xs-projects.vercel.app/api/health)

> **Status:** Phase 0 — foundation. The app is deployed and connected to Postgres; the catalogue
> lands in Phase 1.

<!-- TODO(phase-1): screenshot of the catalogue once it exists. -->

## Stack

| Concern   | Choice                                                |
| --------- | ----------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19                     |
| Language  | TypeScript, strict                                    |
| Styling   | Tailwind CSS v4                                       |
| Data      | PostgreSQL (Neon) via Prisma 7                        |
| Tests     | Vitest, Testing Library                               |
| CI        | GitHub Actions — format, lint, typecheck, test, build |
| Hosting   | Vercel                                                |

One repository, one deployment. Next.js route handlers and server actions cover the API surface, so
there is no separate backend service to run or deploy at this size.

## Running locally

Requires Node 24+ and a PostgreSQL connection string.

```bash
git clone https://github.com/jezreel-x/thrift-shop.git
cd thrift-shop
npm install            # postinstall runs `prisma generate`
cp .env.example .env   # then fill in DATABASE_URL
npm run dev
```

The app serves on http://localhost:3000. `GET /api/health` reports whether the deployment can reach
the database, which is the quickest way to check that `DATABASE_URL` is right.

### Scripts

| Script               | What it does                                  |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Development server                            |
| `npm run build`      | Production build                              |
| `npm test`           | Run the test suite once                       |
| `npm run test:watch` | Watch mode                                    |
| `npm run typecheck`  | `tsc --noEmit`                                |
| `npm run lint`       | ESLint                                        |
| `npm run format`     | Prettier, writing changes                     |
| `npm run db:migrate` | Create and apply a migration in development   |
| `npm run db:deploy`  | Apply pending migrations (used in deployment) |
| `npm run db:studio`  | Prisma Studio                                 |

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
item permanently. Arriving in Phase 2, with a concurrency test alongside it.

**The generated Prisma client is not committed.** `npm install` regenerates it via `postinstall`, in
CI and on Vercel alike, so it can never drift from `prisma/schema.prisma`.

**Payment is confirmed manually in v1.** The buyer pays to a till and submits the M-Pesa
confirmation code; the owner approves it, which flips the item to `SOLD`. Automatic STK Push needs a
registered paybill the business does not have yet. A separate, standalone
`mpesa-daraja-reference` project covers the Daraja API properly.

## Roadmap

- **Phase 0 — Foundation.** Scaffold, Postgres, CI, deployed. ← _here_
- **Phase 1 — Catalogue.** Products, images, search and filters (size first), seed data.
- **Phase 2 — Buying.** Auth, cart, reservation on checkout, manual M-Pesa confirmation.
- **Phase 3 — Admin.** Product CRUD, order management, role-based access.
- **Phase 4 — Operations.** Notifications, reports, CSV export.
