# Authentication

Email and password, with sessions kept in the database. An account is required
to check out, because a reservation has to belong to somebody and an order
confirmed by hand needs a person to contact.

## Sessions are rows, not signed tokens

A JWT cannot be withdrawn once issued. Its validity is a property of the
signature, not of any record you control, so revoking one early means building
machinery around it: short-lived access tokens, refresh tokens, rotation, reuse
detection, a revocation list, a "sessions invalidated at" timestamp. Every piece
exists to recover control the design gave away.

A session row can be deleted. Signing one browser out is a `DELETE`. Signing out
everywhere is a `DELETE` with one condition. There is nothing else to build.

The honest cost is a lookup per request. It is by primary key, in the same
datacentre, on pages that already query this database to render themselves — and
it buys away an entire category of problem.

## The cookie holds a token; the database holds its hash

```
browser cookie:   32 random bytes, base64url
database row id:  sha256(that token)
```

A stolen copy of the database therefore contains nothing anyone can sign in with.

**SHA-256 rather than argon2, deliberately.** Slow hashing exists to make guessing
a _human-chosen_ password expensive. A 32-byte random token has around 256 bits
of entropy — guessing is already hopeless — so a slow hash here would tax every
page load and buy nothing.

The raw token is returned once, at creation, and never stored. Losing it makes
the session unreachable, which is correct rather than a limitation.

## Passwords use argon2id

At the parameters OWASP recommends: 19 MiB of memory, two passes, one lane.
Measured at roughly 150ms per hash — unnoticeable once at sign-in, ruinous across
billions of guesses.

Computed by Node's built-in `crypto.argon2`, which arrived in Node 24.7, rather
than a third-party package. The package used first shipped an unsigned native
binary, and Windows Smart App Control refuses to load unsigned code — so on a
machine enforcing it, sign-in, the password tests and the pre-push hook all
failed. Node's implementation lives inside Node's own signed executable and needs
no dependency. It writes the same PHC strings, so hashes made by the old package
still verify; that was checked against a real one before the switch.

`package.json` requires Node 24.7 or later, and the module refuses to load
without `crypto.argon2`. Without that check an older Node would make every
derivation throw, `verifyPassword` would turn each throw into `false`, and every
sign-in would fail as "those details do not match" — a failure that looks
exactly like people mistyping.

**The memory is the point.** bcrypt uses about 4 KB, which fits comfortably in a
GPU core's local memory, so thousands of guesses run in parallel very cheaply.
Demanding 19 MiB per guess collapses that advantage: a GPU has cores in abundance
and memory in scarcity.

argon2 also has no equivalent of bcrypt's silent 72-byte truncation, where two
different long passphrases sharing a prefix authenticate each other.

A unit test asserts the memory parameter is still at least 19,456 KiB, because a
change to the parameters could otherwise lower it without anything failing.

## Three mistakes that work fine in testing

Each of these is invisible in development and is a vulnerability in production.
Each has a test.

### Enumeration through the response

Saying "no account with that email" hands an attacker a list of who is
registered. Less obviously, so does **timing**: returning in 2ms when there is no
password hash to check, and 40ms when there is, leaks exactly the same fact.

Sign-in therefore verifies against a real throwaway hash when no user exists, so
both paths cost the same, and returns one message for both failures.

### The open redirect

`?next=` is what carries a buyer back to where they were after signing in.
Unvalidated, it turns the sign-in page into a phishing link that **genuinely
belongs to us**: it passes every "check the domain" instinct, because the domain
is correct. The victim signs in on the real site, is bounced to a convincing
copy, and types their password a second time — where a second prompt looks like
an ordinary hiccup.

`safeReturnTo` reduces it to a path within this site. `//evil.example` is the
subtle case: it looks like a path and browsers follow it off-site.

### Check-then-insert on unique data

Two simultaneous sign-ups with the same address both pass a "does this email
exist?" lookup. The `UNIQUE` constraint is the only thing that can actually
decide it, so sign-up attempts the insert and handles the failure, rather than
looking first.

The same reasoning as the reservation: state the precondition where it is
enforced, not before it.

## Sliding sessions

Seven days, extended on use, so somebody who keeps shopping is never signed out
and somebody who stops is forgotten a week after their last visit.

Extending on _every_ request would mean a database write per page view, so
renewal only happens once a session is past halfway through its life — at most
one write per user per 3.5 days, with identical observable behaviour.

Seven rather than thirty because device sharing is common in this market, and a
week-long session on a borrowed or resold handset is a smaller window.

## Cookie flags

| Flag                          | Why                                                            |
| ----------------------------- | -------------------------------------------------------------- |
| `httpOnly`                    | script cannot read it, so an XSS flaw cannot steal the session |
| `sameSite: lax`               | sent on normal navigation, withheld from cross-site POSTs      |
| `secure` in production        | never sent over plain HTTP                                     |
| `maxAge` matching the session | the browser forgets it when the server would                   |

## Where this lives

|                                |                                    |
| ------------------------------ | ---------------------------------- |
| `src/lib/auth/password.ts`     | hashing, email normalisation       |
| `src/lib/auth/session.ts`      | create, read, slide, revoke, sweep |
| `src/lib/auth/current-user.ts` | cookie to user, and `safeReturnTo` |
| `src/lib/auth/actions.ts`      | sign up, sign in, sign out         |
| `prisma/schema.prisma`         | `User`, `Session`, `Role`          |
